package causet

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestRunQueryStringifiesInputAndFlattensItems(t *testing.T) {
	var capturedBody map[string]any
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&capturedBody)
		if r.URL.Path != "/v1/platforms/plat/applications/app/forks/sandbox/queries/top_tracks/run" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"items": []any{
				map[string]any{"track.title": "Song A", "track.genres": []any{"Pop"}},
			},
			"next_cursor": nil,
		})
	})

	result, err := c.RunQuery("top_tracks", map[string]any{
		"genres": []any{"Pop", "Rock"},
		"active": true,
		"limit":  5,
	}, QueryOptions{Limit: 10, IncludeTotal: true})
	if err != nil {
		t.Fatalf("RunQuery: %v", err)
	}

	input, _ := capturedBody["input"].(map[string]any)
	if input["active"] != "true" {
		t.Fatalf("input.active = %v", input["active"])
	}
	if input["genres"] != `["Pop","Rock"]` {
		t.Fatalf("input.genres = %v", input["genres"])
	}
	if capturedBody["limit"] != float64(10) {
		t.Fatalf("body.limit = %v", capturedBody["limit"])
	}
	if capturedBody["include_total"] != true {
		t.Fatalf("body.include_total = %v", capturedBody["include_total"])
	}

	items, ok := result["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("items = %#v", result["items"])
	}
	row := items[0].(map[string]any)
	if row["title"] != "Song A" {
		t.Fatalf("flattened row = %#v", row)
	}
}

func TestListQueriesGetQueryDefinitionListProjections(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/platforms/plat/applications/app/forks/sandbox/queries":
			_ = json.NewEncoder(w).Encode([]any{map[string]any{"slug": "q1"}})
		case "/v1/platforms/plat/applications/app/forks/sandbox/queries/q1":
			_ = json.NewEncoder(w).Encode(map[string]any{"slug": "q1", "params": []any{}})
		case "/v1/platforms/plat/applications/app/forks/sandbox/projections":
			_ = json.NewEncoder(w).Encode([]any{map[string]any{"slug": "p1"}})
		default:
			http.NotFound(w, r)
		}
	})

	queries, err := c.ListQueries()
	if err != nil || len(queries) != 1 {
		t.Fatalf("ListQueries: %#v, %v", queries, err)
	}
	def, err := c.GetQueryDefinition("q1")
	if err != nil || def["slug"] != "q1" {
		t.Fatalf("GetQueryDefinition: %#v, %v", def, err)
	}
	projections, err := c.ListProjections()
	if err != nil || len(projections) != 1 {
		t.Fatalf("ListProjections: %#v, %v", projections, err)
	}
}

func TestListEntitiesSendsFilters(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("forkId") != "sandbox" || q.Get("streamName") != "sku_stream" || q.Get("limit") != "25" {
			t.Fatalf("unexpected query: %v", q)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"entityIds": []any{"sku-1"}})
	})

	result, err := c.ListEntities(ListEntitiesOptions{StreamName: "sku_stream", Limit: 25})
	if err != nil {
		t.Fatalf("ListEntities: %v", err)
	}
	if ids, ok := result["entityIds"].([]any); !ok || len(ids) != 1 {
		t.Fatalf("result = %#v", result)
	}
}
