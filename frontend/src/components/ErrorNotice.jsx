/**
 * SPEC §8: validation is enforced server-side, so this renders whatever the
 * services layer reported rather than a locally invented message.
 */
export default function ErrorNotice({ error }) {
  if (!error) return null
  return (
    <p className="notice notice-error" role="alert">
      {error.message || 'Something went wrong.'}
    </p>
  )
}
