import { render } from "@testing-library/react-native";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";
import { Button } from "./Button";

describe("ui primitives", () => {
  it("Badge renders its label", () => {
    expect(render(<Badge flag="critical" label="TERLAMBAT" />).getByText("TERLAMBAT")).toBeTruthy();
  });
  it("EmptyState renders its message", () => {
    expect(render(<EmptyState message="Belum ada proyek." />).getByText("Belum ada proyek.")).toBeTruthy();
  });
  it("Button renders its label and fires onPress", () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button label="Simpan" onPress={onPress} />);
    expect(getByText("Simpan")).toBeTruthy();
  });
});
