import { ReactNode } from 'react'
import { HandleScope } from './handle-scope'

export default function UserLayout({
  children,
  params,
}: {
  children: ReactNode
  params: { handle: string }
}) {
  return <HandleScope handle={params.handle}>{children}</HandleScope>
}
