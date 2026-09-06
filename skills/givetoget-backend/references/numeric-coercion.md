# numeric-coercion — verification script for the import-processor algorithm

Python-equivalent of `import-processor/index.ts` `coerceForColumn`
for numeric columns (`num_employees`, `annual_revenue`, `quality_score`).
Run it before changing the algorithm to confirm your new version still
handles the cases that have already bitten the project.

## Why this exists

The naive version `Number(cleaned)` returns `NaN` for any range string
(`"51-200"`, `"1,001-5,000"`, `"10000+"`) and silently drops the cell.
The fix midpoint-parses ranges, but the algorithm is easy to get wrong
on the sign-vs-separator distinction. If you're rewriting the regex,
run this script first.

## Script

```python
import re

def coerce(value):
    if value is None:
        return None
    trimmed = value.strip()
    if trimmed == "":
        return None
    stripped = re.sub(r"[,$%\s]", "", trimmed)
    parts = re.split(r"[-+]", stripped)
    nums = []
    for part in parts:
        m = re.match(r"^-?\d+", part)
        if m:
            nums.append(int(m.group(0)))
            if len(nums) == 2:
                break
    if not nums:
        return None
    n = nums[0] if len(nums) == 1 else round((nums[0] + nums[1]) / 2)
    return int(n)


CASES = [
    ("51-200",          125,    "midpoint of range"),
    ("1-10",            6,      "small range, 5.5 rounds up"),
    ("11-50",           30,     "small range midpoint"),
    ("201-1000",        600,    "standard Apollo bucket"),
    ("1001-5000",       3000,   "standard Apollo bucket"),
    ("5001-10000",      7500,   "standard Apollo bucket"),
    ("10000+",          10000,  "open-ended, take the single number"),
    ("1,001-5,000",     3000,   "comma-formatted, commas stripped first"),
    ("100",             100,    "single integer"),
    ("1,000",           1000,   "thousands separator only"),
    ("10000",           10000,  "plain integer"),
    ("$5M",             5,      "currency + suffix; suffix silently ignored"),
    ("5M",              5,      "suffix silently ignored"),
    ("abc",             None,   "no digits -> null, no error"),
    ("",                None,   "empty -> null"),
    ("  ",              None,   "whitespace -> null"),
    ("5.5",             5,      "decimal truncated to int (Math.trunc behavior)"),
    ("n/a",             None,   "no digits -> null"),
    (None,              None,   "None -> null"),
    ("-100",            100,    "leading sign dropped; num_employees can't be negative"),
    ("+50",             50,     "leading plus kept; final int parsed"),
    ("10-20-30",        15,     "three-part range -> take first two"),
    ("10000-99999",     55000,  "large range midpoint"),
    ("10k",             10,     "letter suffix ignored"),
    ("10K",             10,     "letter suffix ignored"),
    ("2,500",           2500,   "single integer with thousands separator"),
    ("1,234,567",       1234567, "multi-thousands separator"),
    ("$1,000,000",      1000000, "currency + multi-thousands"),
    ("$1M-$5M",         3,      "known weird: parses as 1 and 5, midpoint 3; ignore for v1"),
    ("Unknown",         None,   "no digits -> null"),
    ("100+",            100,    "trailing plus dropped"),
    ("50-",             50,     "trailing minus dropped"),
]


def main():
    fails = 0
    for inp, expected, comment in CASES:
        got = coerce(inp)
        ok = got == expected
        marker = "OK" if ok else "FAIL"
        if not ok:
            fails += 1
        print(f"{marker:4} {inp!r:20} -> {got!r:10} expected={expected!r}  # {comment}")
    print()
    print(f"{fails} failures of {len(CASES)} cases")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

## How to use

1. Before changing `coerceForColumn` in
   `supabase/functions/import-processor/index.ts`, copy this script
   into `scripts/` or a scratch file and run it to capture baseline.
2. Apply your change.
3. Re-run. Any failure is a regression.
4. Add new cases for new input shapes you've seen.

The Python version is intentional: faster to iterate than redeploying
the Edge Function for each test. The algorithm has no JS-specific
behavior that wouldn't show up in Python (other than `Math.trunc`,
mirrored by `int()` on a positive float).