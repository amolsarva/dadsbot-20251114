import { DebugPanel } from '../../../debug/debug-panel'

export default function ScopedDebugPage({ params }: { params: { handle: string } }) {
  const handle = params.handle || ''
  return <DebugPanel userHandle={handle} />
}
