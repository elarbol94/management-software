import {
  municipalityDatasetRefSchema,
  type MunicipalityDatasetRef,
} from "./analysis";

export const MUNICIPALITY_DATASET_DRAG_TYPE = "application/x-municipality-dataset";
export const MUNICIPALITY_DATASET_TRANSFER_EVENT = "municipality-dataset-transfer";

export function writeMunicipalityDatasetDrag(
  event: React.DragEvent,
  dataset: MunicipalityDatasetRef,
) {
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(MUNICIPALITY_DATASET_DRAG_TYPE, JSON.stringify(dataset));
}

export function readMunicipalityDatasetDrag(event: React.DragEvent) {
  const value = event.dataTransfer.getData(MUNICIPALITY_DATASET_DRAG_TYPE);
  if (!value) return null;
  const result = municipalityDatasetRefSchema.safeParse(JSON.parse(value));
  return result.success ? result.data : null;
}

export function requestMunicipalityDatasetTransfer(dataset: MunicipalityDatasetRef) {
  window.dispatchEvent(new CustomEvent(MUNICIPALITY_DATASET_TRANSFER_EVENT, { detail: dataset }));
}
