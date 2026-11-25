"""HTTP-level tests for public health and internal service authentication."""
import os
import unittest

# Keep tests independent of developer or production credentials in .env files.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
_TEST_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl"
os.environ.setdefault("SUPABASE_ANON_KEY", _TEST_SUPABASE_KEY)
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", _TEST_SUPABASE_KEY)
os.environ.setdefault("RAG_SERVICE_TOKEN", "test-internal-token-that-is-long-enough")

from fastapi.testclient import TestClient

from app.main import app, settings


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_is_public_and_minimal(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_protected_endpoint_rejects_missing_and_invalid_tokens(self):
        for headers in ({}, {"X-Internal-Token": "invalid-token"}):
            with self.subTest(headers=headers):
                response = self.client.get("/v1/documents", headers=headers)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json(), {"detail": "Service authentication failed"})

    def test_valid_internal_token_passes_service_authentication(self):
        response = self.client.get(
            "/v1/documents",
            headers={"X-Internal-Token": settings.rag_service_token},
        )

        # The route next requires a signed-in user, so this response proves the
        # service-token dependency accepted the internal token.
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), {"detail": "Sign in to use the assistant"})


if __name__ == "__main__":
    unittest.main()
