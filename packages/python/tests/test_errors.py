from causet_sdk.errors import CausetError, CausetAuthError, CausetApiError


def test_causet_error_is_exception():
    err = CausetError("something broke")
    assert isinstance(err, Exception)
    assert str(err) == "something broke"


def test_causet_auth_error_is_causet_error():
    err = CausetAuthError("bad token")
    assert isinstance(err, CausetError)
    assert str(err) == "bad token"


def test_causet_api_error_has_status_and_message():
    err = CausetApiError(422, "Validation failed", {"detail": "missing field"})
    assert isinstance(err, CausetError)
    assert err.status_code == 422
    assert err.message == "Validation failed"
    assert err.body == {"detail": "missing field"}
    assert "422" in str(err)
    assert "Validation failed" in str(err)
