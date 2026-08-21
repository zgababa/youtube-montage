import type { SceneStatus, SpanCategory, StepStatus } from "@/lib/types"
import type { SceneDecision } from "@/src/mastra/stream/contract"

/** `04:12` — the form used in the shot list and scene rows. */
export function timecode(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

/** `30:40` for anything over an hour becomes `1:12:05`. */
export function longTimecode(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  if (h === 0) return timecode(total)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

/** `7.0s` */
export function durationLabel(seconds: number) {
  return `${seconds.toFixed(1)}s`
}

export function relativeDate(iso: string, now = Date.now()) {
  const then = new Date(iso).getTime()
  const days = Math.round((now - then) / 86_400_000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 30) return `${days} days ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`
  const years = Math.round(months / 12)
  return `${years} year${years === 1 ? "" : "s"} ago`
}

export const CATEGORY_LABELS: Record<SpanCategory, string> = {
  filler: "filler",
  redundant: "redundant",
  bad_take: "bad take",
  tangent: "tangent",
  false_start: "false start",
}

/**
 * A decision queued in the review gate but not yet sent — `scene.status`
 * doesn't move until "Send back" is clicked, so this is what tells the tile
 * and row a regenerate/approve/reject is waiting rather than lost.
 */
export const SCENE_DECISION_LABELS: Record<SceneDecision["action"], string> = {
  approve: "Approve queued",
  reject: "Reject queued",
  regenerate: "Regenerate queued",
}

export const SCENE_STATUS_LABELS: Record<SceneStatus, string> = {
  pending: "Pending",
  generating: "Generating",
  ready: "Ready for review",
  approved: "Approved",
  rejected: "Rejected",
  exporting: "Exporting",
  exported: "Exported",
  failed: "Failed",
}

/**
 * Only `Badge` variants — no raw status colours. `exported` and `approved` earn
 * the filled variant; everything neutral stays outline.
 */
export function sceneStatusVariant(
  status: SceneStatus
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "approved":
    case "exported":
      return "default"
    case "generating":
    case "exporting":
    case "ready":
      return "secondary"
    case "failed":
    case "rejected":
      return "destructive"
    default:
      return "outline"
  }
}

export function stepStatusVariant(
  status: StepStatus
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "success":
      return "default"
    case "running":
    case "suspended":
      return "secondary"
    case "failed":
      return "destructive"
    default:
      return "outline"
  }
}
