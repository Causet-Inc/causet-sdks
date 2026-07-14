from causet_sdk.emitter import Emitter


class TestEmitter:
    def test_on_and_emit(self):
        em = Emitter()
        received: list = []
        em.on("click", lambda data: received.append(data))
        em.emit("click", {"x": 1})
        assert received == [{"x": 1}]

    def test_unsubscribe(self):
        em = Emitter()
        received: list = []
        unsub = em.on("click", lambda data: received.append(data))
        em.emit("click", "a")
        unsub()
        em.emit("click", "b")
        assert received == ["a"]

    def test_wildcard_receives_all(self):
        em = Emitter()
        received: list = []
        em.on("*", lambda event_type, data: received.append((event_type, data)))
        em.emit("click", 1)
        em.emit("hover", 2)
        assert received == [("click", 1), ("hover", 2)]

    def test_off(self):
        em = Emitter()
        received: list = []
        handler = lambda data: received.append(data)
        em.on("e", handler)
        em.emit("e", "a")
        em.off("e", handler)
        em.emit("e", "b")
        assert received == ["a"]

    def test_off_wildcard(self):
        em = Emitter()
        received: list = []
        handler = lambda et, d: received.append(d)
        em.on("*", handler)
        em.emit("e", 1)
        em.off("*", handler)
        em.emit("e", 2)
        assert received == [1]

    def test_handler_error_does_not_propagate(self):
        em = Emitter()
        received: list = []

        def bad_handler(data: object) -> None:
            raise RuntimeError("boom")

        em.on("e", bad_handler)
        em.on("e", lambda data: received.append(data))
        em.emit("e", "ok")
        assert received == ["ok"]

    def test_wildcard_handler_error_does_not_propagate(self):
        em = Emitter()
        received: list = []

        def bad_wildcard(_event_type, _data):
            raise RuntimeError("wildcard boom")

        em.on("*", bad_wildcard)
        em.on("*", lambda et, d: received.append((et, d)))
        em.emit("e", "ok")
        assert received == [("e", "ok")]

    def test_multiple_handlers_same_event(self):
        em = Emitter()
        r1: list = []
        r2: list = []
        em.on("e", lambda d: r1.append(d))
        em.on("e", lambda d: r2.append(d))
        em.emit("e", 42)
        assert r1 == [42]
        assert r2 == [42]

    def test_no_handlers_emit_is_safe(self):
        em = Emitter()
        em.emit("nothing", "data")
