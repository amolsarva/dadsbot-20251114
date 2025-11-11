import DiagnosticsPage from '../../../diagnostics/page'

export default function UserDiagnosticsPage({ params }: { params: { handle: string } }) {
  const handle = params.handle || ''
  return <DiagnosticsPage key={`diagnostics:${handle.toLowerCase()}`} />
}
