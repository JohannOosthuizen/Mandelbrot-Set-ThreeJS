# Interactive Mandelbrot Explorer

This is a real-time, interactive Mandelbrot set explorer built with **Three.js** and a custom **GLSL fragment shader**. This project leverages the GPU for high-performance rendering, allowing for smooth, deep zooms into the fractal's infinite complexity.



## ✨ Features

* **Interactive Controls:** Smoothly zoom with the mouse wheel and pan by clicking and dragging.
* **Automated Tours:**
    * **"Start Exploration":** An automated tour that visits several famous fractal locations (Seahorse Valley, Elephant Valley) one after another.
    * **"Build The Set":** A beautiful animation that renders the fractal by slowly increasing the iteration count, "blooming" the set on screen.
* **Preset Locations:** Instantly jump to and auto-zoom into famous regions like "Seahorse Valley," "Elephant Valley," and "Triple Spiral."
* **Dynamic Detail:** The shader's iteration count automatically increases as you zoom deeper, revealing more and more detail without performance loss.
* **Color Themes:** Instantly switch between multiple color palettes, including standard HSV, Grayscale, and a 'Psychedelic' theme.
* **Speed Control:** Adjust the speed of the automated zoom simulations.
