#!/bin/sh
# The validator's own tests (spec §8.6). Six minimal bundles, each a complete
# valid bundle with one deliberate property: five must fail, one must pass.
# A rule with no failing fixture is a rule nobody has run.
#
#   sh scripts/validate-fixtures.sh
#
# `invalid-year-band/` is the one fixture that needs --strict, because
# W_YEAR_BAND is a warning by design (§8.5 rule 7).

set -u
cd "$(dirname "$0")/.." || exit 2
status=0

check() { # name  expected-exit  expected-code  [extra flags…]
  name=$1; want_exit=$2; want_code=$3; shift 3
  out=$(node scripts/validate-content.ts --dir "content/__fixtures__/$name" "$@" 2>&1)
  got_exit=$?
  if [ "$got_exit" -ne "$want_exit" ]; then
    printf '✗ %-24s exit %d, expected %d\n' "$name" "$got_exit" "$want_exit"
    status=1
    return
  fi
  if [ -n "$want_code" ] && ! printf '%s' "$out" | grep -q "$want_code"; then
    printf '✗ %-24s did not report %s\n' "$name" "$want_code"
    status=1
    return
  fi
  printf '✓ %-24s exit %d %s\n' "$name" "$got_exit" "$want_code"
}

check valid-ancestry-sibling 0 ''
check invalid-cycle          1 E_CYCLE
check invalid-year-band      1 W_YEAR_BAND --strict
check invalid-ref            1 E_REF_QUESTION_SUBTOPIC
check invalid-grammar        1 E_ID_GRAMMAR
check invalid-ancestry       1 E_ANCESTRY

exit $status
