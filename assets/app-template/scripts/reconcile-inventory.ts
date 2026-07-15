import { persistSurfaceInventory, type SurfaceObservation } from "../backend-lib/surfaces";

const input = await Bun.stdin.text();
if (!input.trim()) throw new Error("Pass a JSON array of surface observations on stdin");
const observations = JSON.parse(input) as SurfaceObservation[];
if (!Array.isArray(observations)) throw new Error("Inventory input must be a JSON array");
console.log(JSON.stringify({ surfaces: persistSurfaceInventory(observations) }, null, 2));
