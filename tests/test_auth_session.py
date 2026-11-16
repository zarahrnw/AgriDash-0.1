import json

import pytest
from fastapi.testclient import TestClient

from api import main as api_main
from api.main import app, get_current_user


client = TestClient(app)


def test_current_user_requires_token():
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401


@pytest.mark.parametrize("role", ["super_admin", "admin", "user"])
def test_current_user_returns_backend_identity_and_role(role):
    previous_override = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_current_user] = lambda: {
        "username": "pengguna",
        "role": role,
        "must_change_password": False,
    }
    try:
        response = client.get("/api/v1/auth/me")
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous_override

    assert response.status_code == 200
    assert response.json() == {
        "username": "pengguna",
        "role": role,
        "must_change_password": False,
    }


def test_login_form_issues_token_and_rejects_wrong_password(monkeypatch):
    password_hash = api_main.pwd_context.hash("test-password-123")
    users = [{
        "id": 1,
        "username": "pengguna",
        "password_hash": password_hash,
        "role": "admin",
        "must_change_password": False,
    }]
    monkeypatch.setattr(api_main, "read_users", lambda: users.copy())
    monkeypatch.setattr(api_main, "write_audit", lambda *args, **kwargs: None)

    success = client.post(
        "/api/v1/auth/login",
        data={"username": "pengguna", "password": "test-password-123"},
    )
    assert success.status_code == 200
    assert success.json()["token_type"] == "bearer"

    identity = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {success.json()['access_token']}"},
    )
    assert identity.status_code == 200
    assert identity.json() == {
        "username": "pengguna",
        "role": "admin",
        "must_change_password": False,
    }

    failure = client.post(
        "/api/v1/auth/login",
        data={"username": "pengguna", "password": "incorrect-password"},
    )
    assert failure.status_code == 401


def test_admin_cannot_register_users(monkeypatch):
    users = [{
        "id": 1,
        "username": "admin_demo",
        "role": "admin",
        "password_hash": "",
        "must_change_password": False,
    }]
    monkeypatch.setattr(api_main, "read_users", lambda: users.copy())
    monkeypatch.setattr(api_main, "save_users", lambda _: pytest.fail("Users must not be changed."))
    token = api_main.create_access_token({"sub": "admin_demo", "role": "admin"})

    response = client.post(
        "/api/v1/auth/register",
        json={"username": "new_user", "password": "rahasia123", "role": "user"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403


def test_user_cannot_access_upload_or_audit(monkeypatch):
    user = {
        "id": 1,
        "username": "viewer",
        "role": "user",
        "password_hash": "",
        "must_change_password": False,
    }
    monkeypatch.setattr(api_main, "read_users", lambda: [user])
    token = api_main.create_access_token({"sub": "viewer", "role": "user"})
    headers = {"Authorization": f"Bearer {token}"}

    upload = client.post(
        "/api/v1/tanaman-pangan/upload",
        files={"file": ("dataset.csv", "content", "text/csv")},
        headers=headers,
    )
    audit = client.get("/api/v1/audit-trail", headers=headers)

    assert upload.status_code == 403
    assert audit.status_code == 403


def test_admin_endpoints_require_a_token():
    upload = client.post(
        "/api/v1/tanaman-pangan/upload",
        files={"file": ("dataset.csv", "content", "text/csv")},
    )
    audit = client.get("/api/v1/audit-trail")

    assert upload.status_code == 401
    assert audit.status_code == 401


def test_demo_accounts_are_seeded_hashed_and_preserve_existing_users(monkeypatch, tmp_path):
    users_file = tmp_path / "users.json"
    monkeypatch.setattr(api_main, "AUTH_DIR", tmp_path)
    monkeypatch.setattr(api_main, "USERS_FILE", users_file)
    monkeypatch.setattr(api_main, "write_audit", lambda *args, **kwargs: None)
    users_file.write_text(json.dumps([{
        "id": 7,
        "username": "existing",
        "role": "admin",
        "password_hash": "preserve",
    }]), encoding="utf-8")

    users = api_main.read_users()
    accounts = {user["username"]: user for user in users}

    assert accounts["existing"]["password_hash"] == "preserve"
    assert accounts["superadmin"]["role"] == "super_admin"
    assert accounts["user"]["role"] == "user"
    assert accounts["superadmin"]["must_change_password"] is True
    assert accounts["user"]["must_change_password"] is True
    for account in api_main.BOOTSTRAP_ACCOUNTS:
        stored = accounts[account["username"]]
        assert stored["password_hash"] != account["password"]
        assert api_main.pwd_context.verify(account["password"], stored["password_hash"])
        login = client.post(
            "/api/v1/auth/login",
            data={"username": account["username"], "password": account["password"]},
        )
        assert login.status_code == 200
        assert login.json()["role"] == account["role"]
        assert login.json()["must_change_password"] is True

    superadmin = accounts["superadmin"]
    superadmin["password_hash"] = api_main.pwd_context.hash("Replacement-Password-123!")
    superadmin["must_change_password"] = False
    api_main.save_users(users + [dict(superadmin)])

    updated = api_main.read_users()
    assert sum(user["username"] == "superadmin" for user in updated) == 1
    assert any(user["username"] == "existing" for user in updated)
    seeded_superadmin = next(user for user in updated if user["username"] == "superadmin")
    assert seeded_superadmin["must_change_password"] is False
    assert api_main.pwd_context.verify("Replacement-Password-123!", seeded_superadmin["password_hash"])


def test_bootstrap_user_must_change_password_before_super_admin_actions(monkeypatch):
    password_hash = api_main.pwd_context.hash("super123")
    superadmin = {
        "id": 1,
        "username": "superadmin",
        "role": "super_admin",
        "password_hash": password_hash,
        "must_change_password": True,
    }
    monkeypatch.setattr(api_main, "read_users", lambda: [superadmin])
    token = api_main.create_access_token({"sub": "superadmin", "role": "super_admin"})

    response = client.get("/api/v1/audit-trail", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 403
    assert "Ganti password" in response.json()["detail"]


def test_change_password_clears_forced_change_flag(monkeypatch):
    user = {
        "id": 1,
        "username": "viewer",
        "role": "user",
        "password_hash": api_main.pwd_context.hash("user123"),
        "must_change_password": True,
    }
    users = [user]
    monkeypatch.setattr(api_main, "read_users", lambda: users)
    monkeypatch.setattr(api_main, "save_users", lambda _: None)
    monkeypatch.setattr(api_main, "write_audit", lambda *args, **kwargs: None)
    token = api_main.create_access_token({"sub": "viewer", "role": "user"})
    headers = {"Authorization": f"Bearer {token}"}

    response = client.post(
        "/api/v1/auth/change-password",
        json={
            "current_password": "user123",
            "new_password": "New-Strong-Password-123!",
        },
        headers=headers,
    )
    identity = client.get("/api/v1/auth/me", headers=headers)

    assert response.status_code == 200
    assert identity.status_code == 200
    assert identity.json()["must_change_password"] is False
    assert api_main.pwd_context.verify("New-Strong-Password-123!", user["password_hash"])


def test_production_startup_requires_demo_password_changes(monkeypatch):
    user = {"username": "user", "must_change_password": True}
    monkeypatch.setattr(api_main, "APP_ENVIRONMENT", "production")
    monkeypatch.setattr(api_main, "read_users", lambda: [user])

    with pytest.raises(RuntimeError, match="initial demo passwords"):
        with TestClient(app):
            pass
