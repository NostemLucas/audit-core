export interface Thing {
  readonly id: string
  readonly kind: 'A' | 'B'
}

async function load(id: string): Promise<Thing> {
  return { id, kind: 'A' }
}

export async function useThing(id: string): Promise<string> {
  const thing = await load(id)
  await Promise.all([load('1'), load('2')])
  void load('3') // descartado a propósito y explícito
  return thing.kind === 'A' ? 'a' : 'b'
}
