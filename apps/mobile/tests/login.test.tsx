import { render } from "@testing-library/react-native";
import LoginScreen from "../app/(auth)/login";

jest.mock("@/lib/supabase/client", () => ({
  supabase: { auth: { signInWithPassword: jest.fn() } },
}));

describe("LoginScreen", () => {
  it("renders Bahasa title + email/password labels + Masuk button", () => {
    const { getByText } = render(<LoginScreen />);
    expect(getByText("Masuk ke DATUM")).toBeTruthy();
    expect(getByText("Email")).toBeTruthy();
    expect(getByText("Kata sandi")).toBeTruthy();
    expect(getByText("Masuk")).toBeTruthy();
  });
});
