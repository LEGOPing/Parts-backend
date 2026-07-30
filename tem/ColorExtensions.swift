import SwiftUI

// 为Color添加RGB十六进制初始化扩展
extension Color {
    init(rgbHex: String) {
        // 移除可能的#前缀
        let cleanHex = rgbHex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        
        // 解析RGB值
        var rgbValue: UInt64 = 0
        Scanner(string: cleanHex).scanHexInt64(&rgbValue)
        
        let r = Double((rgbValue & 0xFF0000) >> 16) / 255.0
        let g = Double((rgbValue & 0x00FF00) >> 8) / 255.0
        let b = Double(rgbValue & 0x0000FF) / 255.0
        
        self.init(red: r, green: g, blue: b)
    }
}