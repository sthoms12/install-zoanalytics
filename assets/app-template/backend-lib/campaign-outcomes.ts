import { db } from "./db";

type CampaignSnapshot = {
  key: string; propertyId: string; category: string; title: string; childKeys: string[];
  verificationMethod: string; expectedImpact: string;
};

function policy(category: string) {
  if (["tracking", "site audit", "data health", "reliability"].includes(category)) return { hours: 0, minimum: 0, measurement: "source verification" };
  if (category === "performance") return { hours: 7 * 24, minimum: 5, measurement: "poor Core Web Vital observations" };
  if (category === "engagement") return { hours: 14 * 24, minimum: 20, measurement: "engaged visits" };
  return { hours: 72, minimum: 20, measurement: "traffic and conversion observations" };
}

export function scheduleCampaignOutcome(campaign: CampaignSnapshot) {
  const rule = policy(campaign.category);
  const now = new Date();
  const id = `outcome_${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO campaign_outcomes
    (id,campaign_key,property_id,category,title,action_keys,expected_measurement,verification_method,baseline_at,due_at,window_hours,minimum_sample,state)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, campaign.key, campaign.propertyId, campaign.category, campaign.title,
      JSON.stringify(campaign.childKeys), rule.measurement, campaign.verificationMethod, now.toISOString(),
      new Date(now.getTime() + rule.hours * 3_600_000).toISOString(), rule.hours, rule.minimum, rule.hours ? "pending" : "awaiting-verification");
  return id;
}

export function recordCampaignVerification(campaign: CampaignSnapshot, verified: boolean, detail: string) {
  let row = db.query("SELECT id FROM campaign_outcomes WHERE campaign_key=? AND state IN ('pending','awaiting-verification') ORDER BY created_at DESC LIMIT 1").get(campaign.key) as { id: string } | null;
  if (!row) row = { id: scheduleCampaignOutcome(campaign) };
  db.prepare(`UPDATE campaign_outcomes SET state=?, result_detail=?, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(verified ? "fixed-verified" : "verification-failed", detail.slice(0, 1000), row.id);
  if (!verified) {
    const keys = campaign.childKeys;
    const reopen = db.prepare("UPDATE action_states SET status='open', snoozed_until=NULL, note='Reopened after failed source verification', updated_at=CURRENT_TIMESTAMP WHERE action_key=?");
    db.transaction(() => keys.forEach((key) => reopen.run(key)))();
  }
  return row.id;
}

function counts(propertyId: string, at: string, hours: number) {
  const span = Math.max(hours, 72);
  const before = db.query(`SELECT COUNT(*) AS views, COALESCE(AVG(CASE WHEN COALESCE(duration_ms,0)>=10000 THEN 1.0 ELSE 0 END),0) AS engagement
    FROM pageviews WHERE property_id=? AND created_at<? AND created_at>=datetime(?,'-' || ? || ' hours')`).get(propertyId, at, at, span) as { views: number; engagement: number };
  const after = db.query(`SELECT COUNT(*) AS views, COALESCE(AVG(CASE WHEN COALESCE(duration_ms,0)>=10000 THEN 1.0 ELSE 0 END),0) AS engagement
    FROM pageviews WHERE property_id=? AND created_at>=? AND created_at<datetime(?,'+' || ? || ' hours')`).get(propertyId, at, at, span) as { views: number; engagement: number };
  return { before, after };
}

export function classifyCampaignOutcome(input: { category: string; minimumSample: number; sampleBefore: number; sampleAfter: number; valueBefore: number; valueAfter: number; overlappingChanges: number }) {
  if (input.sampleAfter < input.minimumSample) return { state: "insufficient-sample", detail: `Only ${input.sampleAfter} post-campaign observations are available; ${input.minimumSample} are required.` };
  if (input.overlappingChanges > 1) return { state: "confounded", detail: `${input.overlappingChanges} overlapping changes prevent a clean interpretation of the observed outcome.` };
  const threshold = input.category === "engagement" ? 0.05 : Math.max(2, input.valueBefore * 0.1);
  if (input.valueAfter - input.valueBefore >= threshold) return { state: "improved", detail: `Improvement was observed after this campaign (${input.valueBefore.toFixed(2)} before, ${input.valueAfter.toFixed(2)} after).` };
  if (input.valueBefore - input.valueAfter >= threshold) return { state: "regressed", detail: `A regression was observed after this campaign (${input.valueBefore.toFixed(2)} before, ${input.valueAfter.toFixed(2)} after).` };
  return { state: "unchanged", detail: `No material movement was observed after this campaign (${input.valueBefore.toFixed(2)} before, ${input.valueAfter.toFixed(2)} after).` };
}

function matureOutcomes() {
  const rows = db.query("SELECT * FROM campaign_outcomes WHERE state='pending' AND datetime(due_at)<=CURRENT_TIMESTAMP").all() as Array<Record<string, any>>;
  for (const row of rows) {
    const stats = counts(row.property_id, row.baseline_at, row.window_hours);
    const overlap = (db.query(`SELECT COUNT(*) AS count FROM change_events WHERE property_id=? AND occurred_at>=? AND occurred_at<=?`).get(row.property_id, row.baseline_at, row.due_at) as { count: number }).count;
    const sample = stats.after.views;
    const before = row.category === "engagement" ? stats.before.engagement : stats.before.views;
    const after = row.category === "engagement" ? stats.after.engagement : stats.after.views;
    const classification = classifyCampaignOutcome({ category: row.category, minimumSample: row.minimum_sample, sampleBefore: stats.before.views, sampleAfter: sample, valueBefore: before, valueAfter: after, overlappingChanges: overlap });
    db.prepare(`UPDATE campaign_outcomes SET state=?,sample_before=?,sample_after=?,value_before=?,value_after=?,overlapping_changes=?,result_detail=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(classification.state, stats.before.views, stats.after.views, before, after, overlap, classification.detail, row.id);
  }
}

export function listCampaignOutcomes(propertyId?: string) {
  matureOutcomes();
  const where = propertyId ? "WHERE o.property_id=?" : "";
  return db.query(`SELECT o.id,o.campaign_key AS campaignKey,o.property_id AS propertyId,p.name AS propertyName,o.category,o.title,
    o.expected_measurement AS expectedMeasurement,o.verification_method AS verificationMethod,o.baseline_at AS baselineAt,o.due_at AS dueAt,
    o.window_hours AS windowHours,o.minimum_sample AS minimumSample,o.state,o.sample_before AS sampleBefore,o.sample_after AS sampleAfter,
    o.value_before AS valueBefore,o.value_after AS valueAfter,o.overlapping_changes AS overlappingChanges,o.result_detail AS resultDetail,
    o.completed_at AS completedAt,o.created_at AS createdAt FROM campaign_outcomes o JOIN properties p ON p.id=o.property_id ${where} ORDER BY o.created_at DESC LIMIT 200`)
    .all(...(propertyId ? [propertyId] : []));
}

export function reopenCampaignOutcome(id: string) {
  const row = db.query("SELECT action_keys AS actionKeys FROM campaign_outcomes WHERE id=?").get(id) as { actionKeys: string } | null;
  if (!row) throw new Error("Campaign outcome not found");
  const keys = JSON.parse(row.actionKeys) as string[];
  const reopen = db.prepare("UPDATE action_states SET status='open', snoozed_until=NULL, note='Reopened from outcome review', updated_at=CURRENT_TIMESTAMP WHERE action_key=?");
  db.transaction(() => keys.forEach((key) => reopen.run(key)))();
  db.prepare("UPDATE campaign_outcomes SET state='reopened',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  return { ok: true, reopened: keys.length };
}
