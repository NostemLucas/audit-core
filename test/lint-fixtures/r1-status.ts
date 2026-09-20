export function compare(audit: { status: string }): number {
  if (audit.status === 'DRAFT') return 1
  if (audit.status !== 'CLOSED') return 2
  switch (audit.status) {
    case 'A':
      return 3
  }
  return 0
}
