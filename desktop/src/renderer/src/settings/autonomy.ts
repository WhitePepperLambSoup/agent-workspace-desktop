const YOLO_ACKNOWLEDGEMENT_KEY = 'agent-workspace.autonomy-yolo-ack.v1'
const FULL_ACCESS_ACKNOWLEDGEMENT_KEY = 'agent-workspace.autonomy-full-access-ack.v1'

export function confirmAutonomyChange(autonomy: string, message: string): boolean {
  const acknowledgementKey = autonomy === 'yolo'
    ? YOLO_ACKNOWLEDGEMENT_KEY
    : autonomy === 'full_access'
      ? FULL_ACCESS_ACKNOWLEDGEMENT_KEY
      : null
  if (acknowledgementKey === null) return true
  try {
    if (window.localStorage.getItem(acknowledgementKey) === '1') return true
  } catch {
    // A blocked storage backend should not hide the safety explanation.
  }
  if (!window.confirm(message)) return false
  try {
    window.localStorage.setItem(acknowledgementKey, '1')
  } catch {
    // The acknowledgement is optional; the confirmed change may still proceed.
  }
  return true
}
