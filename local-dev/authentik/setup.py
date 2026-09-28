#!/usr/bin/env python3
"""
Deja el Authentik local listo para audit-core desde una instancia recién levantada (solo con el setup wizard ya
hecho, que es lo único que no se puede saltar por API): grupos, usuarios de prueba, y los dos providers OIDC
(audit-core, nextcloud) con sus aplicaciones. Idempotente: correrlo de nuevo no duplica nada, solo confirma que ya
existe.

Requiere AUTHENTIK_BOOTSTRAP_TOKEN en el entorno (./ .env) — se genera solo la primera vez que arranca el contenedor
si AUTHENTIK_BOOTSTRAP_TOKEN ya está en .env antes de `docker compose up` (Authentik lo toma como token inicial).
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://localhost:9000/api/v3"
TOKEN = os.environ["AUTHENTIK_BOOTSTRAP_TOKEN"]
TEST_USERS_PASSWORD = os.environ.get("TEST_USERS_PASSWORD", "Prueba123!")
# Mismo host que ve el navegador Y los contenedores (ver ../nextcloud/README): reemplazar si esta LAN IP no es la
# tuya. NEXTCLOUD_PUBLIC_URL se puede pasar por variable de entorno si no se quiere tocar el default.
NEXTCLOUD_PUBLIC_URL = os.environ.get("NEXTCLOUD_PUBLIC_URL", "https://192.168.0.11.sslip.io:8443")


def api(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        print(f"  ! {method} {path} -> {e.code}: {e.read().decode()}", file=sys.stderr)
        raise


def first(path: str, **params: str) -> dict | None:
    query = f"?{urllib.parse.urlencode(params)}" if params else ""
    results = api("GET", f"{path}{query}")["results"]
    return results[0] if results else None


def ensure_group(name: str) -> str:
    existing = first("/core/groups/", name=name)
    if existing:
        print(f"grupo {name}: ya existe")
        return existing["pk"]
    print(f"grupo {name}: creando")
    return api("POST", "/core/groups/", {"name": name})["pk"]


def ensure_user(username: str, name: str, group_pk: str) -> None:
    existing = first("/core/users/", username=username)
    if existing:
        print(f"usuario {username}: ya existe")
        return
    print(f"usuario {username}: creando")
    created = api(
        "POST",
        "/core/users/",
        {
            "username": username,
            "name": name,
            "email": f"{username}@local.test",
            "groups": [group_pk],
            "is_active": True,
        },
    )
    api("POST", f"/core/users/{created['pk']}/set_password/", {"password": TEST_USERS_PASSWORD})


def ensure_groups_claim_mapping() -> str:
    for m in api("GET", "/propertymappings/provider/scope/?page_size=100")["results"]:
        if m["name"] == "audit-core: groups claim":
            print("mapping 'audit-core: groups claim': ya existe")
            return m["pk"]
    print("mapping 'audit-core: groups claim': creando")
    return api(
        "POST",
        "/propertymappings/provider/scope/",
        {
            "name": "audit-core: groups claim",
            "scope_name": "profile",
            "expression": 'return {"groups": [group.name for group in user.ak_groups.all()]}',
        },
    )["pk"]


def default_scope_mapping(scope_name: str) -> str:
    for m in api("GET", "/propertymappings/provider/scope/?page_size=100")["results"]:
        if m["name"] == f"authentik default OAuth Mapping: OpenID '{scope_name}'":
            return m["pk"]
    raise RuntimeError(f"No se encontró el scope mapping por defecto de '{scope_name}' — ¿Authentik sin inicializar?")


def ensure_oauth2_app(name: str, slug: str, redirect_uri: str, property_mappings: list[str]) -> tuple[str, str]:
    """-> (client_id, client_secret)"""
    existing = first("/providers/oauth2/", name=name)
    authz_flow = first("/flows/instances/", slug="default-provider-authorization-implicit-consent")["pk"]
    inval_flow = first("/flows/instances/", slug="default-provider-invalidation-flow")["pk"]
    signing_key = first("/crypto/certificatekeypairs/", name="authentik Self-signed Certificate")["pk"]
    body = {
        "name": name,
        "authorization_flow": authz_flow,
        "invalidation_flow": inval_flow,
        "signing_key": signing_key,
        "property_mappings": property_mappings,
        "client_type": "confidential",
        "redirect_uris": [{"matching_mode": "strict", "url": redirect_uri, "redirect_uri_type": "authorization"}],
        "sub_mode": "hashed_user_id",
        "issuer_mode": "per_provider",
    }
    if existing:
        print(f"provider '{name}': ya existe")
        provider = api("PATCH", f"/providers/oauth2/{existing['pk']}/", body)
    else:
        print(f"provider '{name}': creando")
        provider = api("POST", "/providers/oauth2/", body)
        api("PATCH", f"/providers/oauth2/{provider['pk']}/", {"grant_types": ["authorization_code", "refresh_token"]})

    if not first("/core/applications/", slug=slug):
        print(f"application '{name}': creando")
        api("POST", "/core/applications/", {"name": name, "slug": slug, "provider": provider["pk"]})
    else:
        print(f"application '{name}': ya existe")

    return provider["client_id"], provider["client_secret"]


def main() -> None:
    admin = ensure_group("ADMIN")
    gerente = ensure_group("GERENTE")
    auditor = ensure_group("AUDITOR")

    ensure_user("gerente1", "Gerente Uno", gerente)
    ensure_user("auditor1", "Auditor Uno", auditor)
    ensure_user("auditor2", "Auditor Dos", auditor)
    del admin  # akadmin ya viene con ADMIN de la instalación; no hace falta un segundo superusuario de prueba

    groups_claim = ensure_groups_claim_mapping()
    openid = default_scope_mapping("openid")
    email = default_scope_mapping("email")
    profile = default_scope_mapping("profile")

    print()
    audit_core_id, audit_core_secret = ensure_oauth2_app(
        "audit-core",
        "audit-core",
        "http://localhost:3000/api/auth/callback",
        [groups_claim, openid, email, profile],
    )
    print()
    nextcloud_id, nextcloud_secret = ensure_oauth2_app(
        "nextcloud",
        "nextcloud",
        f"{NEXTCLOUD_PUBLIC_URL}/apps/user_oidc/code",
        [groups_claim, openid, email, profile],
    )

    print(
        f"""
Listo. Copiar a los .env correspondientes:

  audit-core/.env
    AUTHENTIK_ISSUER=http://localhost:9000/application/o/audit-core/
    AUTHENTIK_CLIENT_ID={audit_core_id}
    # (AUTHENTIK_CLIENT_SECRET no hace falta: audit-core solo valida JWT, no hace el intercambio de código)

  frontend-v2/.env (o el que use ese repo)
    OIDC_CLIENT_ID={audit_core_id}
    OIDC_CLIENT_SECRET={audit_core_secret}

  Registrar en Nextcloud (occ user_oidc:provider — ver ../nextcloud/README.md):
    --clientid={nextcloud_id}
    --clientsecret={nextcloud_secret}
    --discoveryuri=http://<LAN_IP>:9000/application/o/nextcloud/.well-known/openid-configuration
"""
    )


if __name__ == "__main__":
    main()
