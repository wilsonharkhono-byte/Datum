import { render, fireEvent, act } from "@testing-library/react-native";
import LoginScreen from "../app/(auth)/login";

const mockSignInWithPassword = jest.fn().mockResolvedValue({ error: null });

jest.mock("@/lib/supabase/client", () => ({
  supabase: { auth: { signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args) } },
}));

describe("LoginScreen", () => {
  beforeEach(() => {
    mockSignInWithPassword.mockClear();
  });

  it("renders Bahasa title + email/password labels + Masuk button", () => {
    const { getByText } = render(<LoginScreen />);
    expect(getByText("Masuk ke DATUM")).toBeTruthy();
    expect(getByText("Email")).toBeTruthy();
    expect(getByText("Kata sandi")).toBeTruthy();
    expect(getByText("Masuk")).toBeTruthy();
  });

  it("chains email 'next' to password and submits on password 'done'", async () => {
    const { getByTestId } = render(<LoginScreen />);
    const emailInput = getByTestId("login-email-input");
    const passwordInput = getByTestId("login-password-input");

    expect(emailInput.props.returnKeyType).toBe("next");
    expect(passwordInput.props.returnKeyType).toBe("done");

    fireEvent.changeText(emailInput, "user@datum.com");
    fireEvent.changeText(passwordInput, "s3cret123");

    // Pressing "next" on email should not submit yet.
    fireEvent(emailInput, "submitEditing");
    expect(mockSignInWithPassword).not.toHaveBeenCalled();

    // Pressing "done" on password submits with the current email/password.
    await act(async () => {
      fireEvent(passwordInput, "submitEditing");
    });
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: "user@datum.com",
      password: "s3cret123",
    });
  });
});
