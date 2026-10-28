// Checks JSON-LD against the official schema.org vocabulary (release 30.1, compacted from
// https://github.com/schemaorg/schemaorg/blob/main/data/releases/30.1/schemaorg-current-https.jsonld into
// lib/specs/schemaorg-30.1/vocab.json): every @type is a schema.org class, every property exists and applies to the
// node's type (domainIncludes, through superclasses), nested nodes have a type the property accepts (rangeIncludes),
// and enumeration values (https://schema.org/InStock) are members of an accepted enumeration. Text is accepted where
// schema.org expects an item (schema.org allows that fallback); numbers and booleans only where the range says so.
import vocab from "./specs/schemaorg-30.1/vocab.json";

const classes = vocab.classes as Record<string, string[]>;
const properties = vocab.properties as Record<string, { d: string[]; r: string[] }>;
const members = vocab.members as Record<string, string>;
export const SCHEMA_RELEASE = vocab.release;

const ancestorsCache = new Map<string, Set<string>>();
export function ancestors(type: string): Set<string> {
  const hit = ancestorsCache.get(type);
  if (hit) return hit;
  const out = new Set<string>([type]);
  for (const p of classes[type] ?? []) for (const a of ancestors(p)) out.add(a);
  ancestorsCache.set(type, out);
  return out;
}
const isA = (type: string, target: string) => ancestors(type).has(target);
const typesOf = (node: Record<string, unknown>) => (Array.isArray(node["@type"]) ? (node["@type"] as string[]) : node["@type"] ? [String(node["@type"])] : []);
const strip = (t: string) => t.replace(/^https?:\/\/schema\.org\//, "").replace(/^schema:/, "");

export function validateJsonLd(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => validateJsonLd(v, `${path}[${i}]`));
  if (!value || typeof value !== "object") return [`${path}: not a node`];
  const node = value as Record<string, unknown>;
  if (Array.isArray(node["@graph"])) return (node["@graph"] as unknown[]).flatMap((v, i) => validateJsonLd(v, `${path}.@graph[${i}]`));
  const errors: string[] = [];
  const types = typesOf(node).map(strip);
  // An untyped node is a reference (or a named reference) when it has an @id: only its property names are checked.
  if (!types.length && !node["@id"]) return [`${path}: node without @type`];
  for (const t of types) if (!classes[t]) errors.push(`${path}: unknown type ${t}`);
  if (errors.length) return errors;
  for (const [key, v] of Object.entries(node)) {
    if (key.startsWith("@")) continue;
    // schema.org's Potential Actions convention: "<property>-input" / "-output" annotations on an Action.
    const annotation = /^([a-z][A-Za-z]*)-(input|output)$/.exec(key);
    if (annotation && types.some((t) => isA(t, "Action")) && typeof v === "string") continue;
    const prop = properties[key];
    if (!prop) {
      errors.push(`${path}.${key}: not a schema.org property`);
      continue;
    }
    if (types.length && !types.some((t) => prop.d.some((d) => isA(t, d)))) errors.push(`${path}.${key}: does not apply to ${types.join("/")}`);
    for (const [i, item] of (Array.isArray(v) ? v : [v]).entries()) errors.push(...checkValue(item, prop.r, `${path}.${key}${Array.isArray(v) ? `[${i}]` : ""}`));
  }
  return errors;
}

function checkValue(item: unknown, range: string[], path: string): string[] {
  if (item === null || item === undefined) return [`${path}: empty value`];
  if (typeof item === "number") return range.some((r) => isA(r, "Number") || r === "Text") ? [] : [`${path}: a number where ${range.join("/")} is expected`];
  if (typeof item === "boolean") return range.includes("Boolean") ? [] : [`${path}: a boolean where ${range.join("/")} is expected`];
  if (typeof item === "string") {
    const enumOnly = range.length > 0 && range.every((r) => isA(r, "Enumeration"));
    const member = /^https?:\/\/schema\.org\/[A-Za-z]+$/.test(item) ? members[strip(item)] : undefined;
    if (member) return range.some((r) => isA(member, r)) ? [] : [`${path}: ${strip(item)} is not one of ${range.join("/")}`];
    return enumOnly ? [`${path}: "${item}" is not a member of ${range.join("/")}`] : [];
  }
  if (typeof item === "object") {
    const node = item as Record<string, unknown>;
    const types = typesOf(node).map(strip);
    if (types.length && !types.some((t) => range.some((r) => isA(t, r)))) return [`${path}: ${types.join("/")} where ${range.join("/")} is expected`];
    return validateJsonLd(node, path);
  }
  return [`${path}: unsupported value`];
}
