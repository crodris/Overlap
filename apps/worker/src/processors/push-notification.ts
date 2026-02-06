import type { Job } from 'bullmq'
import { db, overlaps, branches, users, pushSubscriptions } from '@overlap/db'
import { eq } from 'drizzle-orm'
import type { PushNotificationJob } from '@overlap/shared'
import webpush from 'web-push'

const APP_URL = process.env.APP_URL || 'http://localhost:3000'

// Configure VAPID
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
const vapidSubject = process.env.VAPID_SUBJECT

if (vapidPublicKey && vapidPrivateKey && vapidSubject) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
}

export async function pushNotificationProcessor(job: Job<PushNotificationJob>) {
  const { repositoryId, overlapId, targetBranchId } = job.data

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.log('VAPID keys not configured, skipping push notification')
    return { sent: 0 }
  }

  // Get the overlap with branch names
  const overlap = await db.query.overlaps.findFirst({
    where: eq(overlaps.id, overlapId),
    with: {
      sourceBranch: true,
      targetBranch: true,
      files: true,
    },
  })

  if (!overlap) {
    console.log(`Overlap not found: ${overlapId}`)
    return { sent: 0 }
  }

  // Get the target branch's last pusher
  const targetBranch = await db.query.branches.findFirst({
    where: eq(branches.id, targetBranchId),
  })

  if (!targetBranch?.lastPusherGithubId) {
    console.log(`No pusher info for branch: ${targetBranchId}`)
    return { sent: 0 }
  }

  // Find the user matching that GitHub ID
  const user = await db.query.users.findFirst({
    where: eq(users.githubId, targetBranch.lastPusherGithubId),
  })

  if (!user) {
    console.log(`User not found for githubId: ${targetBranch.lastPusherGithubId}`)
    return { sent: 0 }
  }

  // Get user's push subscriptions
  const subscriptions = await db.query.pushSubscriptions.findMany({
    where: eq(pushSubscriptions.userId, user.id),
  })

  if (subscriptions.length === 0) {
    console.log(`No push subscriptions for user: ${user.id}`)
    return { sent: 0 }
  }

  // Build notification payload
  // Orient so the recipient's branch appears first (same as UI auto-orient)
  const isRecipientSource = overlap.sourceBranchId === targetBranchId
  const yourBranch = isRecipientSource ? overlap.sourceBranch.name : overlap.targetBranch.name
  const otherBranch = isRecipientSource ? overlap.targetBranch.name : overlap.sourceBranch.name
  const fileCount = overlap.files.length

  const payload = JSON.stringify({
    title: `Overlap Detected · ${fileCount} file${fileCount !== 1 ? 's' : ''}`,
    body: `${yourBranch} ↔ ${otherBranch}`,
    url: `${APP_URL}/repositories/${repositoryId}`,
    tag: `overlap-${overlapId}`,
  })

  let sent = 0

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        payload
      )
      sent++
    } catch (err: any) {
      // Remove expired/invalid subscriptions
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id))
        console.log(`Removed expired subscription: ${sub.id}`)
      } else {
        console.error(`Failed to send push to ${sub.endpoint}:`, err.message)
      }
    }
  }

  console.log(`Sent ${sent}/${subscriptions.length} push notifications for overlap ${overlapId}`)
  return { sent }
}
