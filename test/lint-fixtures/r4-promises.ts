async function save(): Promise<void> {}
async function isValid(): Promise<boolean> {
  return true
}

export function forgetsAwait(): void {
  save() // promesa flotante: ni await ni catch
}

export function thenWithoutCatch(): void {
  save().then(() => undefined)
}

export async function misused(): Promise<void> {
  if (isValid()) {
    // una promesa siempre es truthy: la condición nunca es falsa
  }
  await 42 // await de algo que no es una promesa
}
