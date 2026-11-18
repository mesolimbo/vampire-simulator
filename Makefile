PORT := 8765
PYTHON := python
SERVER := $(PYTHON) scripts/devserver.py

.DEFAULT_GOAL := help
.PHONY: help build zip start stop restart status clean

help:
	@echo make build    - check that the game script parses
	@echo make zip      - build, then zip the game for itch.io into dist/graveyard-shifts.zip
	@echo make start    - build, then serve the game at http://127.0.0.1:$(PORT)/
	@echo make stop     - stop the server
	@echo make restart  - stop, then start
	@echo make status   - say whether the server is running
	@echo make clean    - stop the server and delete .build

build:
	@$(SERVER) build $(PORT)

zip:
	@$(SERVER) zip $(PORT)

start: build
	@$(SERVER) start $(PORT)

stop:
	@$(SERVER) stop $(PORT)

restart: stop start

status:
	@$(SERVER) status $(PORT)

clean: stop
	@$(PYTHON) -c "import shutil; shutil.rmtree('.build', ignore_errors=True)"
