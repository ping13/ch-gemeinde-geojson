WORKDIR ?= assets
WEB_DIR ?= web
ZIP := $(WORKDIR)/swissboundaries_inspire_4326.gml.zip
GML_PATH_FILE := $(WORKDIR)/gml_path.txt
PARQUET ?= $(WORKDIR)/swissboundaries.parquet
PARQUET_OPT ?= $(WORKDIR)/swissboundaries_by_text.parquet
LAYER_FILE := $(WORKDIR)/layer.txt
PARQUET_FIELDS ?= LocalisedCharacterString,text,geometry
LOCAL_ID_PREFIX ?= AdministrativeUnit_Gemeinde_

.PHONY: download extract parquet parquet-optimized gemeinde-geojson bun-install bun-dev bun-build bun-preview clean

download: $(ZIP)

extract: $(GML_PATH_FILE)

parquet: $(PARQUET_OPT)
	mkdir -p $(WEB_DIR)/public/assets
	cp $(PARQUET_OPT) $(WEB_DIR)/public/assets/

parquet-optimized: $(PARQUET_OPT)

$(ZIP):
	mkdir -p $(WORKDIR)
	curl -L -o $@ \
	  "https://data.geo.admin.ch/ch.swisstopo.swissboundaries3d.inspire/swissboundaries3d.inspire/swissboundaries3d.inspire_4326.gml.zip"

$(GML_PATH_FILE): $(ZIP)
	unzip -o $(ZIP) -d $(WORKDIR) >/dev/null
	find $(WORKDIR) -type f -name '*.gml' | head -n1 > $(GML_PATH_FILE)

$(PARQUET): $(GML_PATH_FILE)
	GML=$$(cat $(GML_PATH_FILE)); \
	LAYER=$${LAYER:-$$(ogrinfo -ro -q $$GML \
	  | awk -F': ' '/^[0-9]+: /{print $$2}' \
	  | grep -Ei 'AdministrativeUnit|AdminUnit|AU\.AdministrativeUnit|commune|municip' \
	  | head -n1)}; \
	LAYER=$${LAYER:-$$(ogrinfo -ro -q $$GML \
	  | awk -F': ' '/^[0-9]+: /{print $$2}' \
	  | head -n1)}; \
	echo "$$LAYER" > $(LAYER_FILE); \
	ogr2ogr -overwrite -f Parquet $(PARQUET) $$GML "$$LAYER" \
	  -where "localId LIKE '$(LOCAL_ID_PREFIX)%'" \
	  -select "$(PARQUET_FIELDS)"

$(PARQUET_OPT): $(PARQUET)
	LAYER=$$(ogrinfo -ro -q $(PARQUET) \
	  | awk -F': ' '/^[0-9]+: /{print $$2}' \
	  | head -n1 \
	  | awk -F' \\(' '{print $$1}'); \
	ogr2ogr -overwrite -f Parquet $(PARQUET_OPT) $(PARQUET) \
	  -sql "SELECT text, geometry FROM \"$$LAYER\" ORDER BY text"

clean:
	rm -f $(GML_PATH_FILE) $(LAYER_FILE) $(PARQUET) $(PARQUET_OPT)
	rm -f $(WEB_DIR)/public/assets/$(notdir $(PARQUET_OPT))


bun-install:
	cd $(WEB_DIR) && bun install

bun-dev:
	cd $(WEB_DIR) && bun run dev

bun-build:
	cd $(WEB_DIR) && bun run build

bun-preview:
	cd $(WEB_DIR) && bun run preview

gemeinde-geojson:
	NAME="$${GEMEINDE_NAME:-Zürich}"; \
	OUT="$${OUT:-gemeinde.geojson}"; \
	echo "Extracting Gemeinde '$$NAME' -> $$OUT"; \
	GEMEINDE_NAME="$$NAME" OUT="$$OUT" \
	  ./gemeinde_json.sh
