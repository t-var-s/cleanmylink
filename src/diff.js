export const maxDiffTokens = 300;

const tokenPattern = /(\s+|[/?#&=:.,;!@$'()*+[\]])/;

export function tokenize(text) {
  return text.split(tokenPattern).filter(Boolean);
}

export function diffSegments(input, output) {
  if (input === output) {
    return input ? [{ text: input, kind: "same" }] : [];
  }

  const before = tokenize(input);
  const after = tokenize(output);

  if (before.length > maxDiffTokens || after.length > maxDiffTokens) {
    return compact([
      { text: input, kind: "removed" },
      { text: output, kind: "added" }
    ]);
  }

  const common = commonSuffixLengths(before, after);
  const segments = [];
  let removed = "";
  let added = "";
  let i = 0;
  let j = 0;

  const flushChanges = () => {
    segments.push({ text: removed, kind: "removed" }, { text: added, kind: "added" });
    removed = "";
    added = "";
  };

  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      flushChanges();
      segments.push({ text: before[i], kind: "same" });
      i += 1;
      j += 1;
    } else if (j >= after.length || (i < before.length && common[i + 1][j] >= common[i][j + 1])) {
      removed += before[i];
      i += 1;
    } else {
      added += after[j];
      j += 1;
    }
  }

  flushChanges();
  return compact(segments);
}

// common[i][j] is the longest common subsequence of before[i..] and after[j..].
function commonSuffixLengths(before, after) {
  const common = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));

  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      common[i][j] = before[i] === after[j]
        ? common[i + 1][j + 1] + 1
        : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }

  return common;
}

// Drops empty segments and merges neighbours of the same kind.
function compact(segments) {
  const merged = [];

  for (const segment of segments) {
    if (!segment.text) {
      continue;
    }

    const previous = merged[merged.length - 1];
    if (previous?.kind === segment.kind) {
      previous.text += segment.text;
    } else {
      merged.push({ ...segment });
    }
  }

  return merged;
}
