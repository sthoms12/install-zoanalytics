import { discoverExternalProperties } from "../backend-lib/external";

const result = await discoverExternalProperties();
console.log(JSON.stringify(result, null, 2));
if (result.available === false) process.exitCode = 1;
