// Read complete JSON objects from the current model response. Fences and brief
// prose are tolerated; malformed/truncated JSON is never repaired or guessed.
export function structuredTextOutput(text, schema) {
  const matches = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  const source = String(text || "");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (start < 0) { if (ch === "{") { start = i; depth = 1; } continue; }
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        const value = JSON.parse(source.slice(start, i + 1));
        if (matchesSchemaShape(value, schema)) matches.push(value);
      } catch { /* Try the next complete object. */ }
      start = -1;
    }
  }
  return matches.at(-1) || null;
}

export function matchesSchemaShape(value, schema) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (schema?.required || []).every((key) => {
    if (!Object.hasOwn(value, key)) return false;
    const types = [schema?.properties?.[key]?.type].flat();
    return types.includes(undefined) || types.some((type) => type === "array" ? Array.isArray(value[key]) : type === "null" ? value[key] === null : type === "integer" ? Number.isInteger(value[key]) : typeof value[key] === type);
  });
}
