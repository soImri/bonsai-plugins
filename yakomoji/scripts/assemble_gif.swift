import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(("Error: " + message + "\n").utf8))
    exit(1)
}
let usage = "assemble_gif.swift --sheet FILE --columns N --rows N --output PREFIX [--count N] [--sizes 32,128,384] [--delay 0.14 | --delays 0.2,0.1,0.1,0.2]"
let args = Array(CommandLine.arguments.dropFirst())
if args.contains("--help") { print(usage); exit(0) }
var options: [String:String] = [:]
let allowed: Set<String> = ["--sheet","--columns","--rows","--output","--count","--sizes","--delay","--delays"]
guard args.count % 2 == 0 else { fail(usage) }
for i in stride(from:0,to:args.count,by:2) {
    guard allowed.contains(args[i]), options[args[i]] == nil else { fail("Unknown or repeated option: " + args[i]) }
    options[args[i]] = args[i+1]
}
guard let input=options["--sheet"], let prefix=options["--output"],
      let columns=Int(options["--columns"] ?? ""), let rows=Int(options["--rows"] ?? ""),
      (1...16).contains(columns), (1...16).contains(rows) else { fail(usage) }
let count=Int(options["--count"] ?? String(columns*rows)) ?? 0
guard count >= 2 && count <= columns*rows else { fail("Count must be between 2 and the cell count") }
let sizeParts=(options["--sizes"] ?? "32,128,384").split(separator:",",omittingEmptySubsequences:false)
let sizes=sizeParts.compactMap { Int($0) }
guard sizes.count == sizeParts.count, !sizes.isEmpty, Set(sizes).count == sizes.count,
      sizes.allSatisfy({ (16...2048).contains($0) }) else { fail("Sizes must be unique integers from 16 through 2048") }
guard !(options["--delay"] != nil && options["--delays"] != nil) else { fail("Use --delay or --delays, not both") }
var delays: [Double]
if let list=options["--delays"] {
    let parts=list.split(separator:",",omittingEmptySubsequences:false)
    delays=parts.compactMap { Double($0) }
    guard delays.count == parts.count && delays.count == count else { fail("Provide one delay per frame") }
} else {
    guard let delay=Double(options["--delay"] ?? "0.14") else { fail("Invalid delay") }
    delays=Array(repeating:delay,count:count)
}
guard delays.allSatisfy({ $0.isFinite && $0 >= 0.02 && $0 <= 60 }) else { fail("Delays must be 0.02 to 60 seconds") }
delays=delays.map { ($0*100).rounded()/100 }
guard let source=CGImageSourceCreateWithURL(URL(fileURLWithPath:input) as CFURL,nil),
      let sheet=CGImageSourceCreateImageAtIndex(source,0,nil) else { fail("Cannot read image: " + input) }
guard sheet.width % columns == 0 && sheet.height % rows == 0 else { fail("Sheet dimensions must divide exactly into cells") }
let cw=sheet.width/columns, ch=sheet.height/rows
let cells=(0..<count).map { i in
    sheet.cropping(to:CGRect(x:(i%columns)*cw,y:(i/columns)*ch,width:cw,height:ch))!
}
let fm=FileManager.default
let prefixURL=URL(fileURLWithPath:prefix)
let previewPath=prefix+"-frames"
guard !fm.fileExists(atPath:previewPath), sizes.allSatisfy({ !fm.fileExists(atPath:prefix+"-\($0).gif") }) else {
    fail("Output already exists; choose a new prefix")
}
try fm.createDirectory(at:prefixURL.deletingLastPathComponent(),withIntermediateDirectories:true)
try fm.createDirectory(atPath:previewPath,withIntermediateDirectories:true)
let cs=CGColorSpaceCreateDeviceRGB()
let bi=CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
func render(_ image:CGImage,_ n:Int) -> CGImage {
    var pixels=[UInt8](repeating:0,count:n*n*4)
    pixels.withUnsafeMutableBytes { raw in
        let ctx=CGContext(data:raw.baseAddress,width:n,height:n,bitsPerComponent:8,bytesPerRow:n*4,space:cs,bitmapInfo:bi)!
        ctx.interpolationQuality = .high
        let scale=Double(n-4)/Double(max(cw,ch)), width=Double(cw)*scale, height=Double(ch)*scale
        ctx.draw(image,in:CGRect(x:(Double(n)-width)/2,y:(Double(n)-height)/2,width:width,height:height))
    }
    for i in stride(from:0,to:pixels.count,by:4) {
        let alpha=Int(pixels[i+3])
        if alpha < 150 { for k in 0..<4 { pixels[i+k]=0 } }
        else {
            for k in 0..<3 { pixels[i+k]=UInt8(min(255,Int(pixels[i+k])*255/alpha)) }
            pixels[i+3]=255
        }
    }
    return CGImage(width:n,height:n,bitsPerComponent:8,bitsPerPixel:32,bytesPerRow:n*4,space:cs,bitmapInfo:CGBitmapInfo(rawValue:bi),provider:CGDataProvider(data:Data(pixels) as CFData)!,decode:nil,shouldInterpolate:true,intent:.defaultIntent)!
}
for n in sizes {
    let url=URL(fileURLWithPath:prefix+"-\(n).gif")
    guard let dest=CGImageDestinationCreateWithURL(url as CFURL,UTType.gif.identifier as CFString,count,nil) else { fail("Cannot create GIF") }
    CGImageDestinationSetProperties(dest,[kCGImagePropertyGIFDictionary:[kCGImagePropertyGIFLoopCount:0]] as CFDictionary)
    for i in 0..<count {
        let im=render(cells[i],n)
        CGImageDestinationAddImage(dest,im,[kCGImagePropertyGIFDictionary:[kCGImagePropertyGIFDelayTime:delays[i],kCGImagePropertyGIFUnclampedDelayTime:delays[i]]] as CFDictionary)
        if n == sizes.max()! {
            let pngURL=URL(fileURLWithPath:previewPath+"/frame-\(i).png")
            let png=CGImageDestinationCreateWithURL(pngURL as CFURL,UTType.png.identifier as CFString,1,nil)!
            CGImageDestinationAddImage(png,im,nil)
            guard CGImageDestinationFinalize(png) else { fail("Cannot save frame preview") }
        }
    }
    guard CGImageDestinationFinalize(dest), let check=CGImageSourceCreateWithURL(url as CFURL,nil),
          CGImageSourceGetCount(check)==count else { fail("GIF validation failed") }
    let properties=CGImageSourceCopyProperties(check,nil) as? [String:Any]
    let gif=properties?[kCGImagePropertyGIFDictionary as String] as? [String:Any]
    guard (gif?[kCGImagePropertyGIFLoopCount as String] as? NSNumber)?.intValue == 0 else { fail("Missing infinite-loop metadata") }
    for i in 0..<count {
        guard let frame=CGImageSourceCreateImageAtIndex(check,i,nil), frame.width==n, frame.height==n else { fail("Invalid frame dimensions") }
    }
    let bytes=try fm.attributesOfItem(atPath:url.path)[.size]!
    print("\(url.path): \(count) frames, \(delays.reduce(0,+)) seconds, \(bytes) bytes")
}
