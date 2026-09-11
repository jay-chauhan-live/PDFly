#!/usr/bin/env node
/**
 * Posts a deploy notification to Slack.
 *
 * The coloured sidebar comes from `attachments[].color`, which is the only
 * way Slack still offers one — Block Kit alone has no colour. So the shape is
 * an attachment carrying blocks: the blocks do the layout, the attachment
 * does the stripe down the left.
 *
 *   SLACK_WEBHOOK_URL=... node scripts/slack-notify.mjs started
 *   SLACK_WEBHOOK_URL=... node scripts/slack-notify.mjs succeeded
 *   SLACK_WEBHOOK_URL=... node scripts/slack-notify.mjs failed "migrations"
 *
 * Everything else is read from the environment GitHub Actions already sets.
 * Exits 0 even when Slack is unreachable: a deploy that worked must not be
 * reported as failed because a notification did not arrive.
 */

const STATES = {
  started: {
    color: '#3b82f6', // blue
    emoji: ':rocket:',
    title: 'Deploy started',
  },
  succeeded: {
    color: '#22c55e', // green
    emoji: ':white_check_mark:',
    title: 'Deploy succeeded',
  },
  failed: {
    color: '#ef4444', // red
    emoji: ':rotating_light:',
    title: 'Deploy failed',
  },
  'rolled-back': {
    color: '#f59e0b', // amber
    emoji: ':leftwards_arrow_with_hook:',
    title: 'Deploy rolled back',
  },
};

const state = process.argv[2] ?? 'started';
const detail = process.argv[3] ?? '';

const config = STATES[state];

if (!config) {
  console.error(`Unknown state "${state}". Expected one of: ${Object.keys(STATES).join(', ')}`);
  process.exit(1);
}

const webhook = process.env.SLACK_WEBHOOK_URL;

if (!webhook) {
  // Not an error: Slack is optional, and a repo without the secret should
  // still deploy.
  console.log('SLACK_WEBHOOK_URL is not set; skipping the notification.');
  process.exit(0);
}

const {
  GITHUB_REPOSITORY: repo = 'unknown/unknown',
  GITHUB_SHA: sha = '',
  GITHUB_REF_NAME: branch = 'unknown',
  GITHUB_ACTOR: actor = 'unknown',
  GITHUB_RUN_ID: runId = '',
  GITHUB_SERVER_URL: server = 'https://github.com',
  DEPLOY_ENVIRONMENT: environment = 'production',
  DEPLOY_DURATION: duration = '',
  DEPLOY_HEALTH_URL: healthUrl = '',
} = process.env;

const shortSha = sha.slice(0, 7);
const commitUrl = `${server}/${repo}/commit/${sha}`;
const runUrl = `${server}/${repo}/actions/runs/${runId}`;

/** Slack renders `<url|text>` as a link; plain markdown links do not work. */
const link = (url, text) => `<${url}|${text}>`;

const fields = [
  { type: 'mrkdwn', text: `*Environment*\n${environment}` },
  { type: 'mrkdwn', text: `*Branch*\n\`${branch}\`` },
  { type: 'mrkdwn', text: `*Commit*\n${link(commitUrl, shortSha || 'unknown')}` },
  { type: 'mrkdwn', text: `*By*\n${actor}` },
];

if (duration) {
  fields.push({ type: 'mrkdwn', text: `*Took*\n${duration}` });
}

if (state === 'succeeded' && healthUrl) {
  fields.push({ type: 'mrkdwn', text: `*Health*\n${link(healthUrl, 'passing')}` });
}

const blocks = [
  {
    type: 'header',
    // A header block will not render emoji shortcodes, so the emoji goes in
    // the section below instead of here.
    text: { type: 'plain_text', text: `${config.title} · ${repo.split('/')[1] ?? repo}` },
  },
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `${config.emoji} *${config.title}* for ${link(`${server}/${repo}`, repo)}`,
    },
  },
  // Slack caps a section at ten fields; four or five is comfortably readable.
  { type: 'section', fields: fields.slice(0, 10) },
];

if (detail) {
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*Detail*\n\`\`\`${detail.slice(0, 2800)}\`\`\`` },
  });
}

blocks.push({
  type: 'actions',
  elements: [
    {
      type: 'button',
      text: { type: 'plain_text', text: 'View run' },
      url: runUrl,
      // Slack refuses a style on a button with no url; this one has one.
      ...(state === 'failed' ? { style: 'danger' } : {}),
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: 'View commit' },
      url: commitUrl,
    },
  ],
});

blocks.push({
  type: 'context',
  elements: [{ type: 'mrkdwn', text: `PDFly deploy · ${new Date().toUTCString()}` }],
});

const payload = {
  // The fallback a notification preview and a screen reader use. Without it
  // Slack shows "This content can't be displayed".
  text: `${config.title}: ${repo} @ ${shortSha} (${environment})`,
  attachments: [{ color: config.color, blocks }],
};

try {
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    console.error(`Slack returned ${response.status}: ${await response.text()}`);
  } else {
    console.log(`Slack notified: ${state}`);
  }
} catch (error) {
  console.error(`Could not reach Slack: ${error instanceof Error ? error.message : error}`);
}

// Always succeed. The notification is about the deploy; it is not the deploy.
process.exit(0);
