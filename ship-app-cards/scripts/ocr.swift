// OCR every image listed in a JSON array of paths with macOS Vision, writing
// [{file, lines:[{text, confidence, box}]}] (or {file, error}) to the output path.
// Usage: swift ocr.swift <paths.json> <out.json>
import AppKit
import Foundation
import Vision

let paths = try JSONSerialization.jsonObject(
  with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [String]
var results: [[String: Any]] = []
for path in paths {
  autoreleasepool {
    do {
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = false
      try VNImageRequestHandler(url: URL(fileURLWithPath: path)).perform([request])
      let lines = (request.results ?? []).compactMap { observation -> [String: Any]? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return [
          "text": candidate.string,
          "confidence": candidate.confidence,
          "box": [box.origin.x, box.origin.y, box.width, box.height],
        ]
      }
      results.append(["file": path, "lines": lines])
    } catch {
      results.append(["file": path, "error": String(describing: error)])
    }
  }
}
let data = try JSONSerialization.data(withJSONObject: results, options: [.prettyPrinted, .sortedKeys])
try data.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
print("OCR states: \(results.count)")
