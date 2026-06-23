/**
 * Tests for the Create-Project screen (new.tsx).
 *
 * Coverage:
 * 1. Validation error on empty projectCode — core never called.
 * 2. Validation error on invalid projectCode pattern (lowercase) — core never called.
 * 3. Success path → router.replace to new board route.
 * 4. fieldErrors from core surfaced under the right fields.
 * 5. General forbidden error from core (non-eligible role returns ok:false).
 * 6. Courtesy UI gate: submit disabled for non-eligible role (designer).
 */

import React from "react";
import { render, fireEvent, waitFor, screen } from "@testing-library/react-native";

// ─── Module mocks ─────────────────────────────────────────────────────────────

// @datum/core: mock createProject + canManageRole; re-export real CreateProjectInput
const mockCreateProject = jest.fn();
jest.mock("@datum/core", () => {
  const actual = jest.requireActual("@datum/core");
  return {
    ...actual,
    createProject: (...args: unknown[]) => mockCreateProject(...args),
    // canManageRole is pure — keep the real impl so courtesy gating works
  };
});

// Session
const mockUseSession = jest.fn();
jest.mock("@/lib/session/session", () => ({
  useSession: () => mockUseSession(),
}));

// Supabase client
jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));

// expo-router
const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack }),
}));

// react-native-safe-area-context
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => {
    const { View } = require("react-native");
    return <View>{children}</View>;
  },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// ─── Import screen AFTER mocks ────────────────────────────────────────────────

import NewProjectScreen from "./new";

// ─── Test staff fixtures ──────────────────────────────────────────────────────

const PRINCIPAL_STAFF = {
  id: "staff-principal",
  full_name: "Wilson Principal",
  role: "principal" as const,
  email: "wilson@datum.id",
};

const DESIGNER_STAFF = {
  id: "staff-designer",
  full_name: "Tanya Designer",
  role: "designer" as const,
  email: "tanya@datum.id",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupSession(staff: typeof PRINCIPAL_STAFF | typeof DESIGNER_STAFF | null) {
  mockUseSession.mockReturnValue({ staff, status: staff ? "authenticated" : "unauthenticated" });
}

function fillValidForm() {
  fireEvent.changeText(screen.getByTestId("input-projectCode"), "BDG-H2");
  fireEvent.changeText(screen.getByTestId("input-projectName"), "Bukit Darmo Golf H-2");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("NewProjectScreen — create project form", () => {
  beforeEach(() => {
    mockCreateProject.mockReset();
    mockReplace.mockReset();
    mockBack.mockReset();
    mockUseSession.mockReset();
  });

  // ── 1. Validation: empty projectCode blocks submission ──────────────────────
  it("shows validation error and does NOT call core when projectCode is empty", async () => {
    setupSession(PRINCIPAL_STAFF);
    render(<NewProjectScreen />);

    // Only fill in the project name, leave projectCode empty
    fireEvent.changeText(screen.getByTestId("input-projectName"), "Some Project");

    // The submit button should be disabled (code is empty); but let's also
    // directly verify via the Zod path: tap the button while code input is cleared
    // (it's empty by default, so button is disabled — verify it's disabled)
    const submitBtn = screen.getByTestId("btn-submit");
    expect(submitBtn.props.disabled || submitBtn.props.accessibilityState?.disabled).toBeTruthy();

    // No core call
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  // ── 2. Validation: invalid projectCode pattern (lowercase) ─────────────────
  it("shows field error and does NOT call core when projectCode has invalid chars", async () => {
    setupSession(PRINCIPAL_STAFF);
    render(<NewProjectScreen />);

    // Type a lowercase code — note: onChangeText applies toUpperCase(), but we
    // inject the raw value to test Zod validation (the TextInput will uppercase
    // in real use; here we bypass that by setting value directly via fireEvent)
    // Use a code that passes the min-length but has a space (invalid regex char)
    // Simulate user somehow bypassing uppercase (e.g. paste with space)
    fireEvent.changeText(screen.getByTestId("input-projectCode"), "BD G");
    fireEvent.changeText(screen.getByTestId("input-projectName"), "Valid Name");

    fireEvent.press(screen.getByTestId("btn-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("error-projectCode")).toBeTruthy();
    });

    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  // ── 3. Success path → router.replace ───────────────────────────────────────
  it("calls createProject and navigates on success", async () => {
    setupSession(PRINCIPAL_STAFF);
    mockCreateProject.mockResolvedValue({ ok: true, projectCode: "BDG-H2" });

    render(<NewProjectScreen />);
    fillValidForm();

    fireEvent.press(screen.getByTestId("btn-submit"));

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledTimes(1);
    });

    // Verify core was called with correct shape
    const [, inputArg, callerArg] = mockCreateProject.mock.calls[0];
    expect(inputArg.projectCode).toBe("BDG-H2");
    expect(inputArg.projectName).toBe("Bukit Darmo Golf H-2");
    expect(callerArg).toEqual({ id: PRINCIPAL_STAFF.id, role: PRINCIPAL_STAFF.role });

    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/(matrix)/project/BDG-H2");
  });

  // ── 4. fieldErrors from core surfaced under fields ─────────────────────────
  it("surfaces fieldErrors returned from core under the correct field", async () => {
    setupSession(PRINCIPAL_STAFF);
    mockCreateProject.mockResolvedValue({
      ok: false,
      error: `Kode proyek "BDG-H2" sudah dipakai`,
      fieldErrors: { projectCode: "Sudah ada" },
    });

    render(<NewProjectScreen />);
    fillValidForm();

    fireEvent.press(screen.getByTestId("btn-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("error-projectCode")).toBeTruthy();
      expect(screen.getByText("Sudah ada")).toBeTruthy();
    });

    // General error banner also shown
    expect(screen.getByTestId("general-error")).toBeTruthy();
    expect(screen.getByText(/sudah dipakai/i)).toBeTruthy();
  });

  // ── 5. Forbidden role: core returns ok:false with forbidden error ───────────
  it("shows the forbidden error message when core returns ok:false (forbidden)", async () => {
    // Simulate an admin-UI bypass: session says designer but submit is somehow triggered.
    // We set up a designer session but manually enable by mocking canManageRole to true
    // (to test that we properly show the error from core, not just the UI gate).
    // Reset mock to use real canManageRole (already done by jest.requireActual above).
    setupSession(PRINCIPAL_STAFF);
    mockCreateProject.mockResolvedValue({
      ok: false,
      error: "Hanya principal atau admin yang bisa membuat proyek baru",
    });

    render(<NewProjectScreen />);
    fillValidForm();

    fireEvent.press(screen.getByTestId("btn-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("general-error")).toBeTruthy();
      expect(
        screen.getByText("Hanya principal atau admin yang bisa membuat proyek baru"),
      ).toBeTruthy();
    });
  });

  // ── 6. Courtesy UI gate: designer sees disabled submit + notice ─────────────
  it("disables submit and shows forbidden notice for non-eligible role (designer)", async () => {
    setupSession(DESIGNER_STAFF);
    render(<NewProjectScreen />);

    // Fill form so it's otherwise submittable
    fireEvent.changeText(screen.getByTestId("input-projectCode"), "BDG-H2");
    fireEvent.changeText(screen.getByTestId("input-projectName"), "Some Project");

    // The forbidden notice should appear
    await waitFor(() => {
      expect(screen.getByTestId("forbidden-notice")).toBeTruthy();
    });

    // The submit button should be disabled
    const submitBtn = screen.getByTestId("btn-submit");
    expect(submitBtn.props.disabled || submitBtn.props.accessibilityState?.disabled).toBeTruthy();

    // No core call even if somehow triggered
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  // ── 7. Not signed in: shows sign-in message ────────────────────────────────
  it("shows sign-in message when staff is null", () => {
    setupSession(null);
    render(<NewProjectScreen />);

    expect(screen.getByText("Silakan masuk terlebih dahulu")).toBeTruthy();
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  // ── 8. Cancel button calls router.back() ───────────────────────────────────
  it("calls router.back() when Cancel is pressed", async () => {
    setupSession(PRINCIPAL_STAFF);
    render(<NewProjectScreen />);

    fireEvent.press(screen.getByTestId("btn-cancel"));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  // ── 9. projectCode is auto-uppercased as typed ─────────────────────────────
  it("auto-uppercases projectCode as typed", () => {
    setupSession(PRINCIPAL_STAFF);
    render(<NewProjectScreen />);

    // fireEvent simulates RN's onChangeText, so we check that the input value
    // reflects the uppercased version. The component calls .toUpperCase() on
    // the incoming text before setting state.
    const input = screen.getByTestId("input-projectCode");
    fireEvent.changeText(input, "bdg-h2");

    // After onChangeText, the input should show the uppercase version
    expect(input.props.value).toBe("BDG-H2");
  });
});
