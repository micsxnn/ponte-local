// Ponte Local — download do agent.js (para a rota /api/ponte/download)
import fs from "fs";
import path from "path";

const agentPath = path.join(__dirname, "..", "agente", "agent.js");
const destDir = path.join(__dirname, "download", "ponte-agent");
const destFile = path.join(destDir, "agent.js");

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(agentPath, destFile);
console.log("agent.js copiado para download/ponte-agent/agent.js");
