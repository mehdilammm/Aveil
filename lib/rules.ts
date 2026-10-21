// Scan rules for WooCommerce products. Pure functions, same rules as the WordPress plugin.

export type Severity = "high" | "medium" | "low";
export type Basis = "observed" | "heuristic" | "unavailable";

export type WooProduct = {
  id: number;
  name: string;
  type: string;
  price: string | null;
  regular_price: string | null;
  sale_price: string | null;
  description: string | null;
  images: { id: number; src: string }[] | null;
  virtual: boolean;
  weight: string | null;
  variations?: number[];
  // Used by the feed and page checks. Optional because older WooCommerce versions omit some of them.
  permalink?: string | null;
  short_description?: string | null;
  stock_status?: string | null;
  sku?: string | null;
  global_unique_id?: string | null;
  brands?: { id: number; name: string }[] | null;
  attributes?: { name: string; options?: string[] }[] | null;
};

export type WooVariation = {
  id: number;
  status?: string;
  price: string | null;
  regular_price: string | null;
  sale_price: string | null;
  virtual: boolean;
  weight: string | null;
};

export type Finding = {
  finding_key: string;
  type: string;
  title: string;
  severity: Severity;
  evidence: string;
  guidance: string;
  product_id: number | null;
  basis: Basis;
  fix_url?: string | null;
};

export const MIN_DESCRIPTION_LENGTH = 80;

const NUMBER_RE = /^-?\d+(\.\d+)?$/;

type PriceProblem = "price_missing" | "price_invalid" | "price_negative" | "price_zero" | "sale_price_not_lower";

type PriceInput = Pick<WooProduct, "price" | "regular_price" | "sale_price">;

function trimmed(value: string | null | undefined): string {
  return (value ?? "").trim();
}

// Returns the price problems of one product or variation, worst first.
export function priceProblems(p: PriceInput): PriceProblem[] {
  const price = trimmed(p.price);
  if (price === "") return ["price_missing"];
  if (!NUMBER_RE.test(price)) return ["price_invalid"];
  const value = Number(price);
  if (value < 0) return ["price_negative"];

  const problems: PriceProblem[] = [];
  const regular = trimmed(p.regular_price);
  const sale = trimmed(p.sale_price);
  if (sale !== "" && regular !== "" && NUMBER_RE.test(sale) && NUMBER_RE.test(regular) && Number(sale) >= Number(regular)) {
    problems.push("sale_price_not_lower");
  }
  if (value === 0) problems.push("price_zero");
  return problems;
}

const PRICE_TEXT: Record<Exclude<PriceProblem, "price_zero">, { title: string; guidance: string }> = {
  price_missing: {
    title: "Price missing",
    guidance: "Set a regular price in the product editor (General tab). AI shopping agents skip products without a price.",
  },
  price_invalid: {
    title: "Price is not a number",
    guidance: "Enter the price as a plain number, for example 19.99, without currency symbols or text.",
  },
  price_negative: {
    title: "Price is negative",
    guidance: "Set a price of 0 or more. A negative price is invalid for buyers and agents.",
  },
  sale_price_not_lower: {
    title: "Sale price is not lower than regular price",
    guidance: "Make the sale price lower than the regular price, or clear the sale price.",
  },
};

function describePrice(p: PriceInput): string {
  const show = (v: string | null) => (trimmed(v) === "" ? "empty" : `"${trimmed(v)}"`);
  return `price ${show(p.price)}, regular ${show(p.regular_price)}, sale ${show(p.sale_price)}`;
}

function finding(product: WooProduct, type: string, fields: Omit<Finding, "finding_key" | "type" | "product_id" | "basis" | "fix_url"> & { basis?: Basis }): Finding {
  return {
    finding_key: `${type}:${product.id}`,
    type,
    product_id: product.id,
    basis: fields.basis ?? "observed",
    title: fields.title,
    severity: fields.severity,
    evidence: fields.evidence,
    guidance: fields.guidance,
  };
}

function simplePriceFindings(product: WooProduct): Finding[] {
  return priceProblems(product).map((problem) => {
    if (problem === "price_zero") {
      return finding(product, problem, {
        title: "Price is 0, may be intentional",
        severity: "medium",
        evidence: `Observed ${describePrice(product)}.`,
        guidance: "If the product is not free, set its real price. If it is free on purpose, you can ignore this.",
      });
    }
    return finding(product, problem, {
      ...PRICE_TEXT[problem],
      severity: "high",
      evidence: `Observed ${describePrice(product)}.`,
    });
  });
}

function idList(ids: number[]): string {
  return ids.map((id) => `#${id}`).join(", ");
}

function variablePriceFindings(product: WooProduct, variations: WooVariation[]): Finding[] {
  if (variations.length === 0) {
    return [
      finding(product, "price_missing", {
        title: "Price missing",
        severity: "high",
        evidence: "Variable product has no published variations, so it has no price.",
        guidance: "Add at least one published variation with a price, or change the product type.",
      }),
    ];
  }

  const byProblem = new Map<PriceProblem, number[]>();
  for (const v of variations) {
    for (const problem of priceProblems(v)) {
      byProblem.set(problem, [...(byProblem.get(problem) ?? []), v.id]);
    }
  }

  const findings: Finding[] = [];
  for (const problem of ["price_missing", "price_invalid", "price_negative", "sale_price_not_lower"] as const) {
    const ids = byProblem.get(problem);
    if (!ids) continue;
    findings.push(
      finding(product, problem, {
        title: `${PRICE_TEXT[problem].title} (variations)`,
        severity: "high",
        evidence: `${ids.length} of ${variations.length} variations affected: ${idList(ids)}.`,
        guidance: `Open the Variations tab and fix each listed variation. ${PRICE_TEXT[problem].guidance}`,
      }),
    );
  }

  const zero = byProblem.get("price_zero");
  if (zero && zero.length === variations.length) {
    findings.push(
      finding(product, "price_zero_all_variations", {
        title: "All variations have price 0, may be intentional",
        severity: "medium",
        evidence: `All ${variations.length} variations have price 0: ${idList(zero)}.`,
        guidance: "If the product is not free, set real prices on its variations.",
      }),
    );
  } else if (zero) {
    findings.push(
      finding(product, "price_zero_some_variations", {
        title: "Some variations have price 0, may be intentional",
        severity: "medium",
        evidence: `${zero.length} of ${variations.length} variations have price 0: ${idList(zero)}.`,
        guidance: "Check the listed variations and set their real price unless they are free on purpose.",
      }),
    );
  }
  return findings;
}

export function plainText(html: string | null): string {
  return (html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#?\w+;/g, "x")
    .replace(/\s+/g, " ")
    .trim();
}

function isZeroOrEmptyWeight(weight: string | null): boolean {
  const w = trimmed(weight);
  return w === "" || (NUMBER_RE.test(w) && Number(w) === 0);
}

function weightFindings(product: WooProduct, variations: WooVariation[]): Finding[] {
  const guidance = "Set the weight in the Shipping tab so shipping cost and delivery can be quoted.";
  if (product.type === "variable") {
    // A variation with no weight of its own inherits the parent weight.
    const missing = variations
      .filter((v) => !v.virtual && isZeroOrEmptyWeight(v.weight) && isZeroOrEmptyWeight(product.weight))
      .map((v) => v.id);
    if (missing.length === 0) return [];
    return [
      finding(product, "weight_missing", {
        title: "Physical product has no weight (variations)",
        severity: "medium",
        evidence: `${missing.length} physical variations have empty or zero weight and the parent has none: ${idList(missing)}.`,
        guidance,
      }),
    ];
  }
  if (product.virtual || !isZeroOrEmptyWeight(product.weight)) return [];
  const w = trimmed(product.weight);
  return [
    finding(product, "weight_missing", {
      title: "Physical product has no weight",
      severity: "medium",
      evidence: `Product is not virtual and its weight is ${w === "" ? "empty" : `"${w}"`}.`,
      guidance,
    }),
  ];
}

// variations: published variations of a variable product (ignored for other types).
export function checkProduct(product: WooProduct, variations: WooVariation[] = []): Finding[] {
  const findings: Finding[] = [];
  const hasPrice = product.type !== "grouped";
  const isShipped = product.type !== "grouped" && product.type !== "external";

  if (hasPrice) {
    findings.push(...(product.type === "variable" ? variablePriceFindings(product, variations) : simplePriceFindings(product)));
  }

  const description = plainText(product.description);
  if (description.length < MIN_DESCRIPTION_LENGTH) {
    findings.push(
      finding(product, "description_short", {
        title: "Description is short",
        severity: "low",
        basis: "heuristic",
        evidence: `Description has ${description.length} characters of text (under ${MIN_DESCRIPTION_LENGTH}).`,
        guidance: "Write a description that says what the product is, its materials, sizes and use. Agents rely on it to match buyer questions.",
      }),
    );
  }

  // Older WooCommerce versions return a placeholder image with id 0 when none is set.
  const images = (product.images ?? []).filter((img) => img.id !== 0);
  if (images.length === 0) {
    findings.push(
      finding(product, "image_missing", {
        title: "No featured image",
        severity: "medium",
        evidence: "Product has no images.",
        guidance: "Set a product image in the editor sidebar (Product image).",
      }),
    );
  }

  if (isShipped) findings.push(...weightFindings(product, variations));

  return findings;
}
