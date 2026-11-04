def scrub:
	walk(if type == "string" then
		(reduce $secrets[] as $secret (.; split($secret.real) | join($secret.placeholder)))
		| gsub($private_ipv4; $documentation_ipv4)
	else . end);

.mappings[]
| .response |= (
	{status, headers: ((.headers // {}) | with_entries(select(.key == "Content-Type"))), body, base64Body}
	| if .body != null and (.headers["Content-Type"] // "" | startswith("application/json"))
		then .jsonBody = (.body | fromjson) | del(.body)
		else . end
	| with_entries(select(.value != null)))
| {request, response}
| scrub
