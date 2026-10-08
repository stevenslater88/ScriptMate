#!/usr/bin/env bash
# SEC-002 production verification — disposable identities only.
API="${1:-https://scriptmate-8.emergent.host}"
TAG="sec002-prodverify-$(date +%s)-$RANDOM"
A="${TAG}-a"; B="${TAG}-b"

mint() {
  curl -s -m 20 -X POST "$API/api/auth/device-session" -H "Content-Type: application/json" \
    -d "{\"device_id\":\"$1\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])"
}
TA=$(mint "$A"); TB=$(mint "$B")
for pair in "$A:$TA" "$B:$TB"; do
  curl -s -m 20 -o /dev/null -X POST "$API/api/users" -H "Authorization: Bearer ${pair#*:}" \
    -H "Content-Type: application/json" -d "{\"device_id\":\"${pair%%:*}\"}"
done
AUTH="Authorization: Bearer $TA"
req() { curl -s -m 25 -w ' [HTTP %{http_code} | %{time_total}s]' "$@"; echo; }

echo "Disposable A=$A  B=$B"
echo "TEST A  legit free, RC id = A (limits):";        req "$API/api/users/$A/limits" -H "$AUTH" -H "X-RC-App-User-Id: $A"
echo "TEST A2 legit, no RC header (limits):";          req "$API/api/users/$A/limits" -H "$AUTH"
echo "TEST C  attack, RC id = B (limits):";            req "$API/api/users/$A/limits" -H "$AUTH" -H "X-RC-App-User-Id: $B"
echo "TEST C2 attack, RC id = B (POST /rehearsals):";  req -X POST "$API/api/rehearsals" -H "$AUTH" -H "X-RC-App-User-Id: $B" -H "Content-Type: application/json" -d '{"script_id":"x","user_character":"ALEX","mode":"performance"}'
echo "TEST C3 A tier after attack (no header):";       req "$API/api/users/$A/limits" -H "$AUTH"
echo "TEST D  anonymous RC id (limits):";              req "$API/api/users/$A/limits" -H "$AUTH" -H 'X-RC-App-User-Id: $RCAnonymousID:sec002prodverify'
echo "TEST E  /revenuecat/sync body = B:";             req -X POST "$API/api/users/$A/revenuecat/sync" -H "$AUTH" -H "Content-Type: application/json" -d "{\"revenuecat_app_user_id\":\"$B\"}"
echo "TEST F  /subscribe body = B:";                   req -X POST "$API/api/users/$A/subscribe" -H "$AUTH" -H "Content-Type: application/json" -d "{\"plan\":\"monthly\",\"revenuecat_app_user_id\":\"$B\"}"
echo "TEST G  /start-trial body = B:";                 req -X POST "$API/api/users/$A/start-trial" -H "$AUTH" -H "Content-Type: application/json" -d "{\"revenuecat_app_user_id\":\"$B\"}"
echo "TEST E2 /revenuecat/sync body = A (legit path):"; req -X POST "$API/api/users/$A/revenuecat/sync" -H "$AUTH" -H "Content-Type: application/json" -d "{\"revenuecat_app_user_id\":\"$A\"}"
