import SwiftUI

// 搜索页面的零件名称联想弹窗视图
struct SearchPartNameSuggestionPopupView: View {
    let suggestions: [String]
    let onSelect: (String) -> Void
    let onCancel: (() -> Void)?
    
    // 按数值分组并排序
    private var groupedSuggestions: [(key: String, value: [String])] {
        // 首先处理排序：数字单词优先，然后按数值排序
        let sortedSuggestions = suggestions.sorted { 
            // 检查是否是数字相关单词
            let isFirstNumber = $0.contains(where: { $0.isNumber }) || $0.lowercased().contains("x")
            let isSecondNumber = $1.contains(where: { $0.isNumber }) || $1.lowercased().contains("x")
            
            if isFirstNumber != isSecondNumber {
                return isFirstNumber
            }
            
            // 对于包含 "x" 的组合，按数值排序
            if $0.lowercased().contains("x") && $1.lowercased().contains("x") {
                // 提取数字数组用于比较
                func extractNumbers(_ text: String) -> [Int] {
                    let components = text.components(separatedBy: CharacterSet(charactersIn: "xX ")).filter { !$0.isEmpty }
                    return components.compactMap { Int($0) }
                }
                
                let firstNumbers = extractNumbers($0)
                let secondNumbers = extractNumbers($1)
                
                // 按数字数组顺序比较
                for (a, b) in zip(firstNumbers, secondNumbers) {
                    if a != b {
                        return a < b
                    }
                }
                // 如果前面的数字都相同，较短的排在前面
                return firstNumbers.count < secondNumbers.count
            }
            
            // 对于纯数字，按数值排序
            if let firstNum = Int($0.components(separatedBy: .whitespaces).first ?? ""), 
               let secondNum = Int($1.components(separatedBy: .whitespaces).first ?? "") {
                return firstNum < secondNum
            }
            
            // 其他情况按字母顺序排序
            return $0 < $1
        }
        
        // 按数值分组
        var groups = [String: [String]]()
        
        for suggestion in sortedSuggestions {
            var key: String
            
            // 提取分组键
            if suggestion.lowercased().contains("x") {
                // 对于 "A x B" 格式，使用第一个数字作为分组键
                let components = suggestion.components(separatedBy: CharacterSet(charactersIn: "xX ")).filter { !$0.isEmpty }
                if let firstNum = components.first.flatMap({ Int($0) }) {
                    key = String(firstNum)
                } else {
                    // 如果无法提取数字，使用首字母
                    key = suggestion.prefix(1).uppercased()
                }
            } else if let firstWord = suggestion.components(separatedBy: .whitespaces).first, let num = Int(firstWord) {
                // 对于纯数字开头的单词，使用数字作为分组键
                key = String(num)
            } else {
                // 对于其他单词，使用首字母作为分组键
                key = suggestion.prefix(1).uppercased()
            }
            
            if var group = groups[key] {
                // 对同一组内的项目进行排序，特别是处理 "A x B" 格式
                group.append(suggestion)
                // 对组内项目按第二个数字排序（如果有）
                group.sort { 
                    if $0.lowercased().contains("x") && $1.lowercased().contains("x") {
                        func extractNumbers(_ text: String) -> [Int] {
                            let components = text.components(separatedBy: CharacterSet(charactersIn: "xX ")).filter { !$0.isEmpty }
                            return components.compactMap { Int($0) }
                        }
                        
                        let firstNumbers = extractNumbers($0)
                        let secondNumbers = extractNumbers($1)
                        
                        // 按第二个数字排序
                        if firstNumbers.count > 1 && secondNumbers.count > 1 {
                            return firstNumbers[1] < secondNumbers[1]
                        }
                    }
                    return $0 < $1
                }
                groups[key] = group
            } else {
                groups[key] = [suggestion]
            }
        }
        
        // 转换为排序后的数组，数字键按数值排序，字母键按字母顺序排序
        return groups.sorted { 
            // 尝试将键转换为数字进行比较
            if let firstNum = Int($0.key), let secondNum = Int($1.key) {
                return firstNum < secondNum
            }
            // 一个是数字，一个是字母，数字在前
            if Int($0.key) != nil {
                return true
            }
            if Int($1.key) != nil {
                return false
            }
            // 都是字母，按字母顺序排序
            return $0.key < $1.key
        }
    }
    
    var body: some View {
        VStack(spacing: 10) {
            // 标题
            HStack {
                Text("选择建议单词")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(Color(red: 0x2c/255, green: 0x3e/255, blue: 0x50/255))
                Spacer()
                // 退回按钮
                if let onCancel = onCancel {
                    Button(action: onCancel) {
                        Text("退回")
                            .font(.system(size: 14))
                            .foregroundColor(.blue)
                    }
                }
            }
            .padding(15)
            .overlay(
                Rectangle()
                    .frame(height: 1)
                    .foregroundColor(Color.gray.opacity(0.2))
                    .alignmentGuide(.bottom) { d in d[.bottom] }
                , alignment: .bottom
            )
            
            // 分组建议
            ScrollView(.vertical, showsIndicators: true) {
                VStack(spacing: 15) {
                    ForEach(groupedSuggestions, id: \.key) {
                        group in
                        VStack(alignment: .leading, spacing: 8) {
                            // 组标题
                            Text(group.key)
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
                                .padding(.horizontal, 15)
                            
                            // 水平滚动的单词列表
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    ForEach(group.value, id: \.self) {
                                        suggestion in
                                        Button(action: {
                                            onSelect(suggestion)
                                        }) {
                                            Text(suggestion)
                                                .font(.system(size: 14))
                                                .foregroundColor(.primary)
                                                .padding(.horizontal, 12)
                                                .padding(.vertical, 8)
                                                .background(Color(red: 0xf8/255, green: 0xf9/255, blue: 0xfa/255))
                                                .border(Color.gray.opacity(0.2))
                                                .cornerRadius(4)
                                        }
                                    }
                                }
                                .padding(.horizontal, 15)
                            }
                        }
                    }
                }
                .padding(10)
            }
        }
        .frame(width: 700, height: 500)
        .background(Color.white)
        .cornerRadius(10)
        .shadow(radius: 5)
    }
}
