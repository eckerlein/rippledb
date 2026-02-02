#!/usr/bin/env tsx
/**
 * Find potentially slow/inefficient TypeScript types
 *
 * Analyzes TypeScript files for patterns that are known to cause performance issues:
 * - Deep conditional type chains
 * - Complex union/intersection types
 * - Recursive types
 * - Types with many extends clauses
 *
 * Usage:
 *   pnpm tsx scripts/src/find-slow-types.ts
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, extname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "../..");
const PACKAGES_DIR = join(ROOT, "packages");

interface TypeComplexity {
  file: string;
  typeName: string;
  line: number;
  conditionalDepth: number;
  extendsCount: number;
  unionCount: number;
  intersectionCount: number;
  score: number;
}

function countConditionalDepth(content: string, startIndex: number): number {
  let depth = 0;
  let maxDepth = 0;
  let i = startIndex;
  let inType = false;
  let parenDepth = 0;

  while (i < content.length) {
    const char = content[i];
    const next3 = content.substring(i, i + 3);
    const next5 = content.substring(i, i + 5);
    const next6 = content.substring(i, i + 6);

    if (char === "(") parenDepth++;
    if (char === ")") parenDepth--;

    // Check for conditional type pattern: X extends Y ? A : B
    if (
      next6 === "extends"
      && parenDepth === 0
      && content[i - 1] !== "?"
      && content[i - 1] !== ":"
    ) {
      // Look ahead for ?
      let j = i + 6;
      while (j < content.length && /\s/.test(content[j])) j++;
      if (content[j] === "?") {
        depth++;
        maxDepth = Math.max(maxDepth, depth);
        i = j;
        continue;
      }
    }

    // Check for ternary operator
    if (char === "?" && parenDepth === 0) {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
    }

    if (char === ":" && parenDepth === 0 && depth > 0) {
      // Check if this is a ternary : or type parameter :
      let j = i - 1;
      let foundQuestion = false;
      while (j >= startIndex && /\s/.test(content[j])) j--;
      if (content[j] === "?") {
        depth--;
      }
    }

    // End of type (semicolon or new type definition)
    if (
      (char === ";" || char === "}" || next5 === "export" || next5 === "type ")
      && parenDepth === 0
      && depth === 0
    ) {
      break;
    }

    i++;
  }

  return maxDepth;
}

function analyzeType(
  content: string,
  typeMatch: RegExpMatchArray,
): TypeComplexity {
  const typeName = typeMatch[1] || "anonymous";
  const startIndex = typeMatch.index!;
  const line = content.substring(0, startIndex).split("\n").length;

  // Extract the type body
  let typeBody = "";
  let braceCount = 0;
  let parenCount = 0;
  let inBody = false;
  let i = startIndex;

  // Find the start of the type body (after = or <)
  while (i < content.length) {
    if (content[i] === "=") {
      inBody = true;
      i++;
      break;
    }
    i++;
  }

  // Extract until semicolon or next type/export
  while (i < content.length && inBody) {
    const char = content[i];
    typeBody += char;

    if (char === "(") parenCount++;
    if (char === ")") parenCount--;
    if (char === "{") braceCount++;
    if (char === "}") braceCount--;

    // End conditions
    if (
      (char === ";" || (char === "}" && braceCount === 0 && parenCount === 0))
      && i > startIndex + 10
    ) {
      break;
    }

    // Check for next type definition
    if (
      (content.substring(i, i + 5) === "type "
        || content.substring(i, i + 6) === "export")
      && braceCount === 0
      && parenCount === 0
    ) {
      break;
    }

    i++;
  }

  // Analyze complexity
  const conditionalDepth = countConditionalDepth(content, startIndex);
  const extendsCount = (typeBody.match(/\bextends\b/g) || []).length;
  const unionCount = (typeBody.match(/\s\|\s/g) || []).length;
  const intersectionCount = (typeBody.match(/\s&\s/g) || []).length;

  // Calculate complexity score
  const score = conditionalDepth * 10 // Each conditional level is expensive
    + extendsCount * 3 // Each extends check
    + unionCount * 2 // Union types can be slow
    + intersectionCount * 2; // Intersection types

  return {
    file: "",
    typeName,
    line,
    conditionalDepth,
    extendsCount,
    unionCount,
    intersectionCount,
    score,
  };
}

function findTypesInFile(filePath: string): TypeComplexity[] {
  try {
    const content = readFileSync(filePath, "utf-8");
    const types: TypeComplexity[] = [];

    // Find type definitions
    const typeRegex = /(?:export\s+)?type\s+(\w+)\s*[=<]/g;
    let match;

    while ((match = typeRegex.exec(content)) !== null) {
      const complexity = analyzeType(content, match);
      complexity.file = filePath.replace(ROOT + "/", "");
      types.push(complexity);
    }

    return types;
  } catch (error) {
    return [];
  }
}

function getAllTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(currentDir: string) {
    try {
      const entries = readdirSync(currentDir);

      for (const entry of entries) {
        const fullPath = join(currentDir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          // Skip node_modules, dist, etc.
          if (
            !entry.startsWith(".")
            && entry !== "node_modules"
            && entry !== "dist"
            && entry !== ".next"
            && entry !== "out"
          ) {
            walk(fullPath);
          }
        } else if (
          stat.isFile() && extname(entry) === ".ts" && !entry.endsWith(".d.ts")
        ) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Ignore errors
    }
  }

  walk(dir);
  return files;
}

console.log("🔍 Finding Potentially Slow TypeScript Types\n");
console.log("=".repeat(80));

const allFiles = getAllTypeScriptFiles(PACKAGES_DIR);
const allTypes: TypeComplexity[] = [];

console.log(`\n📁 Scanning ${allFiles.length} TypeScript files...\n`);

for (const file of allFiles) {
  const types = findTypesInFile(file);
  allTypes.push(...types);
}

// Sort by complexity score (highest first)
allTypes.sort((a, b) => b.score - a.score);

console.log("=".repeat(80));
console.log("\n📊 Top 20 Most Complex Types\n");
console.log(
  "File".padEnd(40)
    + "Type".padEnd(25)
    + "Score".padEnd(8)
    + "Cond".padEnd(6)
    + "Ext".padEnd(5)
    + "Union".padEnd(6)
    + "Inter",
);
console.log("-".repeat(80));

for (const type of allTypes.slice(0, 20)) {
  const fileShort = type.file.length > 38
    ? "..." + type.file.slice(-35)
    : type.file;
  console.log(
    fileShort.padEnd(40)
      + type.typeName.padEnd(25)
      + type.score.toString().padEnd(8)
      + type.conditionalDepth.toString().padEnd(6)
      + type.extendsCount.toString().padEnd(5)
      + type.unionCount.toString().padEnd(6)
      + type.intersectionCount.toString(),
  );
}

console.log("\n" + "=".repeat(80));
console.log("\n💡 Legend:");
console.log("  Score: Complexity score (higher = potentially slower)");
console.log("  Cond:  Maximum conditional type depth");
console.log("  Ext:   Number of 'extends' checks");
console.log("  Union: Number of union operators (|)");
console.log("  Inter: Number of intersection operators (&)");
console.log(
  "\n⚠️  Types with high scores (especially >30) may benefit from optimization.",
);
