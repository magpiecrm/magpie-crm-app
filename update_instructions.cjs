const fs = require('fs');
const industriesContent = fs.readFileSync('src/features/prospects/constants/industries.ts', 'utf-8');
const match = industriesContent.match(/export const INDUSTRIES = (\[[\s\S]*?\])/);
if (match) {
  const industries = eval(match[1]);
  let md = fs.readFileSync('agents/instructions.md', 'utf-8');
  md += '\n\n---\n\n## 5. Valid Generect Industries\n\nWhen setting the `industry` criteria in `updatePersona`, you **MUST ONLY** use exact strings from this list. If the user mentions an industry like "ecommerce", map it to the closest match (e.g., "Online and Mail Order Retail").\n\n```json\n' + JSON.stringify(industries, null, 2) + '\n```\n';
  
  // Also update the instructions text
  md = md.replace(
    /industry string\[\]/g,
    'industry string[] (MUST be exact matches from the Valid Generect Industries list below)'
  );

  fs.writeFileSync('agents/instructions.md', md, 'utf-8');
  console.log('Successfully updated agents/instructions.md');
} else {
  console.log('Failed to parse industries');
}
