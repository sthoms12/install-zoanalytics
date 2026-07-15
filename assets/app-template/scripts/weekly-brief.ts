import { createWeeklyOwnerBrief } from "../backend-lib/weekly-brief";

const brief = await createWeeklyOwnerBrief();
console.log(JSON.stringify({ ok: true, id: brief.id, generatedAt: brief.generatedAt, priorities: brief.priorities.length }, null, 2));
