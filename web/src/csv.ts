// Minimal CSV reader with the same behavior encoding/csv has in main.go:
// quoted fields, doubled quotes, LF/CRLF line endings, leading whitespace
// trimmed, empty lines skipped, variable field counts allowed.
export function parseCSV(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;
  let lineHasContent = false;

  const endField = () => {
    record.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRecord = () => {
    if (lineHasContent) {
      endField();
      records.push(record);
    }
    record = [];
    field = "";
    fieldStarted = false;
    lineHasContent = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === "\r" && text[i + 1] === "\n") continue;
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else inQuotes = false;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      continue;
    }
    lineHasContent = true;
    if (c === ",") endField();
    else if (c === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if ((c === " " || c === "\t") && !fieldStarted) continue;
    else {
      field += c;
      fieldStarted = true;
    }
  }
  endRecord();
  return records;
}

export function formatCSV(rows: string[][]): string {
  return rows.map((row) => row.map(quote).join(",")).join("\n") + "\n";
}

function quote(field: string): string {
  if (field === "" || !/[",\r\n]|^\s/.test(field)) return field;
  return `"${field.replaceAll('"', '""')}"`;
}
