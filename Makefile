.PHONY: logs logs-error logs-follow status restart stop start build rebuild ps kill-containers clean-containers

# === Logs ===

logs:
	tail -100 logs/nanoclaw.log

logs-error:
	tail -100 logs/nanoclaw.error.log

logs-follow:
	tail -f logs/nanoclaw.log

logs-all:
	tail -f logs/nanoclaw.log logs/nanoclaw.error.log

# === Service ===

status:
	systemctl --user status nanoclaw

restart:
	systemctl --user restart nanoclaw
	@sleep 2
	@tail -10 logs/nanoclaw.log

stop:
	systemctl --user stop nanoclaw

start:
	systemctl --user start nanoclaw

# === Build ===

build:
	npm run build

rebuild: build restart

# === Docker ===

ps:
	docker ps --filter "name=nanoclaw" --format "table {{.Names}}\t{{.Status}}\t{{.RunningFor}}\t{{.Ports}}"

kill-containers:
	docker ps -q --filter "name=nanoclaw-" | xargs -r docker kill

clean-containers:
	docker ps -aq --filter "name=nanoclaw-" | xargs -r docker rm -f

# === Debug ===

groups:
	@node -e "const db=require('better-sqlite3')('./store/messages.db');console.table(db.prepare('SELECT jid,name,folder,is_main,requires_trigger FROM registered_groups').all())"

env:
	@grep -v '^\s*$$' .env | grep -v '^#'

# === Canon RAG ===

CANON_DIR=/home/bs/PycharmProjects/aifaith/canon
CANON_RAG_DIR=/home/bs/PycharmProjects/aifaith/canon-rag
CANON_INDEX_DIR=/home/bs/PycharmProjects/aifaith/canon-index

index-canon:
	cd $(CANON_RAG_DIR) && python3 index-canon.py --canon-dir $(CANON_DIR) --output $(CANON_INDEX_DIR)/canon-index.json
	cp $(CANON_RAG_DIR)/canon-search.mjs $(CANON_INDEX_DIR)/

search-canon:
	@read -p "Query: " q && node $(CANON_INDEX_DIR)/canon-search.mjs --query "$$q" --index $(CANON_INDEX_DIR)/canon-index.json --embed-url http://localhost:1234 --full -n 5

# === Casebook ===

PROPOSALS_DIR=groups/slack_prophet/casebook-proposals

proposals:
	@echo "Pending proposals:" && ls -1 $(PROPOSALS_DIR)/proposal-*.md 2>/dev/null || echo "  (none)"

approve:
	@echo "Pending proposals:" && ls -1 $(PROPOSALS_DIR)/proposal-*.md 2>/dev/null || echo "  (none)"
	@read -p "File to approve: " f && $(CANON_RAG_DIR)/approve-casebook-entry.sh "$(PROPOSALS_DIR)/$$f"

approve-file:
	$(CANON_RAG_DIR)/approve-casebook-entry.sh $(FILE)