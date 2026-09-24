"use client";

import { useRive } from "@rive-app/react-canvas";

export default function RiveRobot() {
const { RiveComponent } = useRive({
src: "/robot.riv",
autoplay: true,
});

return (
<div
style={{
width: "400px",
height: "400px",
position: "fixed",
right: "20px",
bottom: "20px",
zIndex: 1000,
}}
>
<RiveComponent />
</div>
);
}