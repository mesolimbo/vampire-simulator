# TRELLIS.2 model cheat sheet

How to get good 3D models from TRELLIS.2 on Comfy Cloud, with source images from Comfy Cloud or polymodel. Taken from the Park Freeze Tag asset build (November 2026).

## 1. Plan the asset list

- List every asset as its own object. Anything that moves or repeats on its own (a slide, a bridge, a fence section) is a separate asset.
- Write down real dimensions in metres for each one. They go in the prompt and help you scale the mesh later.
- Pick one style phrase and reuse it word for word in every prompt.

## 2. Generate one source image per asset

Use either tool. Both can reach Nano Banana, which gave clean results.

**Comfy Cloud MCP:** `partner_generate` with `type: "image"`, `model: "vertexai/nano-banana-2"`, `aspect_ratio: "1:1"`. Send many at once with `submit_batch`.

**polymodel MCP:** `generate_image` with `model: "nano-banana"` (or `gpt-image`, `flux-3`, `p-image`), `width` and `height` set to a square such as 1024, and `output_path` pointing at your concepts folder. It saves straight to disk, so there is nothing to download.

### Prompt pattern for props

```
 Single stylized cartoon <object> as a 3D game asset: <dimensions in metres,
 materials, colors>. No <parts that belong to other assets>. Chunky, solid
 proportions, <style phrase>. Three-quarter view from slightly above, whole
 object in frame with margin, even shadowless studio lighting, no ground,
 pure white background.
```

Example:

```
 Single stylized cartoon park bench as a 3D game asset, warm brown wooden slat
 seat and backrest, dark wrought-iron end frames, 2 metres wide. Chunky, solid
 proportions, polished animated-film style. Three-quarter view from slightly
 above, whole object in frame with margin, even shadowless studio lighting,
 no ground, pure white background.
```

### Prompt pattern for characters

```
 Full-body 3D character concept of <character>, <style phrase>. Standing
 straight, facing the camera, symmetrical A-pose with arms held out 40 degrees
 from the body, legs slightly apart. <Plain clothing>. No logos, no patterns,
 no accessories. Clean separate color regions for hair, skin, shirt, trousers,
 shoes. Even, shadowless studio lighting, entire figure in frame with margin,
 pure white background.
```

### What makes an image mesh well

- One object, whole, with a margin on every side.
- Pure white background, no ground plane, no grass, no cast shadow.
- Flat, shadowless lighting. Baked shadows end up in the texture.
- Thick shapes. Thin rails, chains, roots and post tops come out ragged.
- Three-quarter view for props, so TRELLIS sees depth. Straight-on A-pose for characters, so rigging is easy.
- Name what to leave out ("no ladder, no tower attached"), or the model adds it.
- Close every opening on a building. Fill an open doorway with a flat dark panel set slightly back in its frame, and make the door a separate asset. A see-through doorway made image-to-3D models build a hollow shell with missing walls.
- Plain color regions on characters, so you can recolor variants later.
- Make wall details deep. A pale, shallow relief (a cream cross on a gable) vanished from the mesh even though the background mask kept it. Ask for a block that sticks well out with its side face visible, on a dark border plate.
- TRELLIS.2 guesses the hidden back from the front, so a church came back with its door and cross copied onto the rear wall. Keep anything that must not repeat on the visible faces, or accept and fix the back later.

### Matching orthographic views

To get front, rear, side and top views that line up, generate a three-quarter view first, then generate the front elevation from it, then each other view with the front elevation as the first reference image. Ask for "the same ground line, eave and ridge at the same pixel heights". Front and rear came out pixel-identical in outline. Measure the side and plan against the front and fix them in code: rescale the plan to the front's width and the side's depth, and if the side's ridge sits below the front's gable peak, stretch its roof band up to it.

The `3d_pixal3d_multi_views` template is not a good use of these views for buildings. Its second crop feeds the left view, not the back, so check the saved `*_view` images for the panel order. It also rescales each crop to fill its frame, and still built a four-sided building with a cross and turrets on every face.

Check that the saved image is opaque. `gpt-image` sometimes returns a transparent PNG with a soft coloured halo around the object, which meshes badly: flatten it onto white with a hard alpha cut first.

Look at every image before meshing it. Regenerate any that crop the object, add a floor, or merge two assets.

## 3. Run TRELLIS.2 on Comfy Cloud

Template: `3d_pixal3d_trellis2_image_to_model`. `estimate_credits` reported 0 API credits for it.

1. `upload_file` each source image. Keep the file name it returns.

1. `run_template` with these `input_overrides`:

   ```json
    {
      "122": { "image": "<uploaded file name>" },
      "186": { "target_face_count": 200000 },
      "316": { "value": true },
      "322": { "filename_prefix": "3d/<project>_<asset>" }
    }
   ```

   Node 316 is the "Switch to Trellis2" boolean. It defaults to `false`, which runs Pixal3D instead.

1. Run one asset alone first to test the pipeline.

1. Send the rest as one `submit_batch` of `run_template` items.

1. Download the GLB from node 322 (`Save3DAdvanced`) into a raw models folder. Output links expire, so call `get_output` with the job ID for a fresh one.

1. Record each job ID next to its asset name.

The template marks every material fully metallic. In three.js, set `metalness` to 0 and drop the metalness map on load unless the asset is metal, or it renders near black without an environment map.

1. Check each GLB before using it: weld vertices by position and count edges that belong to only one triangle. A closed mesh has none. Renders from the front can hide a missing back wall.

Node IDs can change if the template is updated. Check them with `get_template_schema` before the first run.

## 4. Make the low-poly version in the same template

This is the default for buildings and other static props. In a three-way test on one building (November 2026) it was the only path that gave a closed mesh, it had the fewest UV islands, it looked the same as the dense mesh, and it used no API credits.

The template already remeshes to a solid, decimates, unwraps, and bakes colour, normal and occlusion maps from the dense mesh. So run each asset twice with the same seeds:

1. Raw master: node 186 at `200000`, node 288 (texture size) at `4096`. Save to the raw models folder.
1. Game mesh: rerun that job with `submit_workflow`, `from_prompt_id` and `input_overrides` that set node 186 to the triangle budget and node 288 to `2048`. About 10,000 triangles suits a building and about 2,500 a small prop.

The account runs one of these jobs at a time, so a batch finishes in sequence.

Render the game mesh before you accept it. The template's decimation held up on a plain cottage and on flat doors, but it tore the base, arches and doorway of two ornate buildings at both 10,000 and 25,000 triangles, while their raw masters were clean. For a model like that, build the game mesh from the raw master in headless Blender (`blender -b --python`), one model per process:

1. Build a shrink-wrapped envelope rather than decimating the master directly. On the church this gave a closed, straight 22,000-triangle mesh that matched the master, where a decimate or quad remesh had left holes and bowed walls:
   1. If the master's walls are see-through (tracery, a slot under the eaves), first add a solid core inside it, just behind the walls and under the roof, coloured like the wall in shade. Use the master plus core as the bake source too. Find the walls' inner faces by casting rays through the model.
   1. Copy the master and thicken it inward with Solidify (about two voxels, offset -1). Leave Even Thickness off: it throws sharp corners far outward, and the remesh balloons.
   1. Voxel remesh at a fine size (0.006 on a 1-unit model) so thin parts such as a cross and spires survive. A coarse voxel punches holes through thin walls.
   1. Shrinkwrap onto the master: nearest surface point, outside surface.
   1. Halve the triangle count with Decimate, shrinkwrap again, and repeat until you reach the budget, counting open edges at each step.
   1. Finish with a light Smooth (factor 0.3, two passes) to separate vertices the wrap piled onto one point. Do not dissolve or collapse the degenerate triangles: both tore the church open.
   1. Keep the master's coordinates, so shader masks keyed to model position still line up.
1. Unwrap with xatlas, not Smart UV Project. On a reduced TRELLIS mesh, Smart UV Project made about one island per two triangles (9,924 islands using 7% of the texture on a 20,000-triangle church). xatlas gave 3,631 islands using 42% on the same mesh, and 46 to 500 on simple props. Blender's Python has no xatlas, so dump the vertices and faces to JSON, run `xatlas` in an outside Python (`pip install xatlas`), and rebuild the mesh from its vertex map, faces and UVs. Count the islands afterwards: a model in the thousands for a simple shape means the unwrap failed.
1. Bake with selected-to-active from the master: a normal bake, and the colour as an emission bake. The master's material is fully metallic, so a diffuse bake comes out black.
1. Set the bake's max ray distance to 0 (no limit) and cage extrusion to about 3% of the model size, or patches miss.
1. Carry an existing UV mask (window glow) across the same way: bake it from the old game mesh as emission onto the new UVs. For a texture variant, bake both the variant and the old plain texture from the old mesh, and take only the texels where they differ onto the new base.

The result is triangles only, with no edge loops. For a model that needs quads, use section 5, or one of the two Comfy Cloud quad paths, both of which left open edges and many more UV islands in the same test:

- Hunyuan3D retopology and UV (`TencentSmartTopologyNode`, `TencentModelTo3DUVNode`): Comfy Cloud refuses GLB uploads, so chain these onto the TRELLIS graph in one workflow. Use `Get3DComponents` to turn the OBJ back into a mesh, then the template's bake nodes to texture it. Face count is low, medium or high only.
- Tripo P2 with `model.quad` true: it returns FBX only, so wire output slot 2 to the save node. The stock template wires the GLB output and fails.

## 5. Clean up in Blender when you need quads

TRELLIS output is dense, triangulated and split along UV seams. For a rigged or deforming model, retopologize it by hand.

1. Import the GLB. Scale it to the dimensions from step 1 and put its base at z = 0.
1. Voxel remesh it to a clean mesh of at most about 120,000 faces. If a shell is thinner than a voxel, thicken it first or it gets holes.
1. Retopologize with Quad Remesher (`bpy.ops.qremesher.remesh`), not QuadriFlow. It runs modally: call it with a window override and let control return to Blender. The result is named `Retopo_<input>`.
1. Limit each remesh attempt to about 240 seconds, then retry coarser. Dense or decimated input stalls it.
1. Leave hard-edge detection off, except on props with sharp planes such as a pyramid roof.
1. UV unwrap the low mesh and bake the TRELLIS texture onto it from the high mesh.
1. Save each prop in its own .blend file holding only the low-poly result, then merge the props into the scene file. Keep the high-res sources out of the scene file.
1. Save a checkpoint every few minutes with rotating backups. Blender can hang during remeshing.

## 6. Make the game-ready version

- After a Blender retopology, do a second, lower-poly pass and bake normal maps to carry the lost detail. Section 4 output already has them.
- Export GLB with WebP textures at quality 80.
- Reference result: a whole playground of 12 assets came to 57,600 triangles and 3.9 MB.

## 7. Texture variants

For a plain recolour, change the baked texture locally from a color table.

For a look that needs repainting (lit windows, decay, moss), an AI edit of the UV atlas works with care. Tested with polymodel `gpt-image` at the texture's own size, with the atlas as the first reference image and the concept art as the second:

- Say that the image is a UV texture atlas, not a scene, and that every shape must stay at the same pixel position and size. Name the one thing to change.
- Check drift before use: compare edge maps of the original and the edit, and render the edit on the model.
- For a local change such as lit windows, keep the original texture and composite in only the texels the edit changed (bright, saturated, and far from the base colour). The rest of the texture then cannot drift.
- If the model cannot find the feature in the atlas, render the asset straight-on with flat lighting, edit that view, and bake it back through a second UV map projected from the same view. Composite the result the same way.
- For an emission mask (window glass, a grille), skip the image model. Render flat-lit orthographic views of each wall, threshold the dark glass inside a loose box around each window, and bake those masks back through the same projection into one mask texture. This keeps the pane shapes and tracery, and it works however fragmented the UVs are. Limit the projection to faces that face the view and sit in the outer shell on that side.

## Quick checklist

-  Asset list with dimensions and one shared style phrase
-  One square image per asset: isolated, white background, no ground, flat light, thick shapes
-  Images reviewed before meshing
-  One TRELLIS test run with node 316 true, then the rest at 200,000 faces
-  GLBs downloaded, open edges counted, job IDs recorded
-  Static props: rerun each job at the game triangle budget, render it, and fall back to a Blender decimate and bake if it tore
-  Models that need quads: voxel remesh, Quad Remesher, bake, low-poly pass
-  WebP textures
-  Variants by local recolor, or by a checked and composited AI edit