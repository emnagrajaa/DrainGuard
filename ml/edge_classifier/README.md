# Layer 1 — Edge Debris Classifier (not yet built)

Trains the 4-class classifier (empty / solid_trash / organic_silt /
false_positive) from synthetic or real echo-distance sequences, then
exports to TFLite Micro for the ESP32-S3.

Planned files:
- synthetic_data.py  — generate labeled echo sequences
- train.py            — small 1D-CNN or gradient-boosted tree
- export_tflite.py    — int8 quantization + export
- evaluate.py          — honest accuracy report on held-out data

Until this exists, edge_simulator/node.py fakes classifier_output with
a plausible random distribution so the rest of the pipeline can be
built and demoed against it.
