/**
 * Minimal RFC4180 CSV parser. The FFXIV datamining CSV exports quote fields
 * containing commas/newlines (e.g. item descriptions), so a naive split(",")
 * is not safe - this handles quoted fields, escaped quotes (""), and
 * newlines embedded inside quoted fields.
 */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...dataRows] = rows;
  return { header: header ?? [], rows: dataRows };
}

/** Turns parsed rows into objects keyed by header name, for readable column access. */
export function toRecords(header: string[], rows: string[][]): Record<string, string>[] {
  const indexByName = new Map(header.map((name, i) => [name, i]));
  return rows.map((row) => {
    const record: Record<string, string> = {};
    for (const [name, index] of indexByName) {
      record[name] = row[index] ?? "";
    }
    return record;
  });
}
