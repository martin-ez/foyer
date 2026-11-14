import { Fill, RoundedRect, Shadow } from "react-native-skia";
import { fitPage } from "./fit-page";

const margin = 24;

/** The Skia elements of one empty page centred on the desk, for a canvas of the given size. */
export function BlankPageDrawing({ width, height }: { width: number; height: number }) {
  const page = fitPage(width - margin * 2, height - margin * 2);
  const x = (width - page.width) / 2;
  const y = (height - page.height) / 2;

  return (
    <>
      <Fill color="#e9e4da" />
      <RoundedRect x={x} y={y} width={page.width} height={page.height} r={6} color="#fffdf8">
        <Shadow dx={0} dy={2} blur={8} color="rgba(0, 0, 0, 0.18)" />
      </RoundedRect>
    </>
  );
}
