import { Home } from '../../page'

export default function UserHomePage({ params }: { params: { handle: string } }) {
  const handle = params.handle || ''
  return <Home key={`user:${handle.toLowerCase()}`} userHandle={handle} />
}
