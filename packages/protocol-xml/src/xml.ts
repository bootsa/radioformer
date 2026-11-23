/** Escapes text for use inside an XML element, removing characters the radios choke on. */
export function xmlText(s: string, max = 100): string {
  const clean = [...s]
    .filter((c) => {
      const n = c.codePointAt(0)!;
      return n === 9 || n === 10 || n === 13 || (n >= 32 && n !== 0xfffe && n !== 0xffff && !(n >= 0xd800 && n <= 0xdfff));
    })
    .join('')
    .replace(/[\r\n\t]+/g, ' ');
  return [...clean]
    .slice(0, max)
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export type Item = Record<string, string | number>;

export function renderList(items: Item[], total = items.length): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<ListOfItems>', `  <ItemCount>${total}</ItemCount>`];
  for (const item of items) {
    lines.push('  <Item>');
    for (const [k, v] of Object.entries(item)) lines.push(`    <${k}>${v}</${k}>`);
    lines.push('  </Item>');
  }
  lines.push('</ListOfItems>');
  return lines.join('\n');
}
