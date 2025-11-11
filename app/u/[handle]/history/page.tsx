import HistoryView from '../../../history/history-view'

export default function UserHistoryPage({ params }: { params: { handle: string } }) {
  const handle = params.handle || ''
  return <HistoryView key={`history:${handle.toLowerCase()}`} userHandle={handle} />
}
