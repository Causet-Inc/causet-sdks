from causet_sdk.patch import get_path, set_path, apply_patch


class TestGetPath:
    def test_simple_key(self):
        assert get_path({"a": 1}, "/a") == 1

    def test_nested_key(self):
        assert get_path({"a": {"b": {"c": 42}}}, "/a/b/c") == 42

    def test_missing_key(self):
        assert get_path({"a": 1}, "/b") is None

    def test_invalid_path_no_slash(self):
        assert get_path({"a": 1}, "a") is None

    def test_empty_path(self):
        assert get_path({"a": 1}, "") is None

    def test_none_object(self):
        assert get_path(None, "/a") is None

    def test_array_index(self):
        assert get_path({"items": [10, 20, 30]}, "/items/1") == 20

    def test_invalid_array_index(self):
        assert get_path({"items": [10]}, "/items/not-int") is None
        assert get_path({"items": [10]}, "/items/5") is None


class TestSetPath:
    def test_simple_set(self):
        obj: dict = {"a": 1}
        set_path(obj, "/a", 2)
        assert obj["a"] == 2

    def test_nested_creates_intermediates(self):
        obj: dict = {}
        set_path(obj, "/a/b/c", 42)
        assert obj == {"a": {"b": {"c": 42}}}

    def test_invalid_path_no_slash(self):
        obj: dict = {"a": 1}
        set_path(obj, "a", 2)
        assert obj["a"] == 1

    def test_empty_path(self):
        obj: dict = {"a": 1}
        set_path(obj, "", 2)
        assert obj == {"a": 1}


class TestApplyPatch:
    def test_replace(self):
        state = {"name": "Alice"}
        apply_patch(state, [{"op": "replace", "path": "/name", "value": "Bob"}])
        assert state["name"] == "Bob"

    def test_add(self):
        state: dict = {}
        apply_patch(state, [{"op": "add", "path": "/score", "value": 100}])
        assert state["score"] == 100

    def test_remove(self):
        state = {"a": 1, "b": 2}
        apply_patch(state, [{"op": "remove", "path": "/b"}])
        assert "b" not in state

    def test_remove_nested(self):
        state = {"user": {"name": "Alice", "age": 30}}
        apply_patch(state, [{"op": "remove", "path": "/user/age"}])
        assert state == {"user": {"name": "Alice"}}

    def test_multiple_ops(self):
        state = {"x": 1}
        apply_patch(state, [
            {"op": "replace", "path": "/x", "value": 2},
            {"op": "add", "path": "/y", "value": 3},
        ])
        assert state == {"x": 2, "y": 3}

    def test_none_ops_ignored(self):
        state = {"a": 1}
        apply_patch(state, None)
        assert state == {"a": 1}

    def test_invalid_path_skipped(self):
        state = {"a": 1}
        apply_patch(state, [{"op": "replace", "path": "no-slash", "value": 2}])
        assert state == {"a": 1}
